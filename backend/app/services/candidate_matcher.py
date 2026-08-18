import json
import re
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from app.models.candidate import Candidate
from app.models.evaluation import Evaluation
from app.models.job_posting import JobPosting
from app.models.schemas import WeightConfig
from app.services import handoff_service
from app.services.azure_services import openai_service, search_service
from app.services.evidence_tracker import evidence_tracker
from app.services.matching_signals import blend_signals, keyword_signal, semantic_signal
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError
from app.utils.validators import normalize_skill, redact_name, redact_pii


DEFAULT_WEIGHTS = WeightConfig()

BENCH_PRIORITY_BOOST = 8.0


def bench_sort_key(overall_score: float, employment_status: Optional[str], tie_breaker: str) -> tuple:
    boosted = min(100.0, overall_score + BENCH_PRIORITY_BOOST) if employment_status == "bench" else overall_score
    return (-boosted, -overall_score, tie_breaker)


class CandidateMatcher:
    def _to_text(self, value: Any) -> str:
        if isinstance(value, dict):
            return " ".join(str(v) for v in value.values() if isinstance(v, (str, int, float)))
        if isinstance(value, list):
            return " ".join(self._to_text(item) for item in value)
        return str(value or "")

    def _normalize_weight(self, values: list[float], weights: list[float]) -> float:
        total = sum(weights) or 1.0
        return round(sum(v * w for v, w in zip(values, weights, strict=False)) / total, 2)

    def _title_alignment_score(self, candidate: Candidate, job: JobPosting) -> float:
        job_blob = normalize_skill(job.title)
        candidate_blob = normalize_skill(
            " ".join(
                [
                    candidate.resume_text or "",
                    self._to_text(candidate.experience),
                    self._to_text(candidate.projects),
                    self._to_text(candidate.enriched_profile),
                ]
            )
        )
        if not candidate_blob:
            return 50.0
        job_tokens = [token for token in re.split(r"[^a-z0-9]+", job_blob) if len(token) > 2]
        hits = sum(1 for token in job_tokens if token in candidate_blob)
        if hits >= 2:
            return 95.0
        if hits == 1:
            return 80.0
        domain_markers = ["backend", "frontend", "platform", "data", "ml", "devops", "cloud", "sre"]
        if any(marker in candidate_blob for marker in domain_markers) and any(marker in job_blob for marker in domain_markers):
            return 75.0
        return 60.0

    def _communication_text(self, candidate: Candidate) -> str:
        profile = candidate.enriched_profile or {}
        profile_parts: list[str] = []
        for key in ("about", "summary", "bio", "headline", "description"):
            value = profile.get(key)
            if value:
                profile_parts.append(str(value))
        return "\n".join([candidate.resume_text or "", *profile_parts]).strip()

    def _heuristic_communication(self, text: str) -> dict[str, Any]:
        if not text.strip():
            return {
                "score": 50.0,
                "explanation": "Not enough text to assess communication style.",
                "evidence": [],
            }

        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
        bullets = len(re.findall(r"(^|\n)\s*[-*•]", text))
        quantified = len(re.findall(r"\b\d+(?:\.\d+)?%?|\$\d+|p95|p50|x\b", text, re.I))
        avg_len = sum(len(s) for s in sentences) / max(len(sentences), 1)
        variance = sum((len(s) - avg_len) ** 2 for s in sentences) / max(len(sentences), 1)

        score = 55.0
        score += min(15.0, bullets * 2.5)
        score += min(15.0, quantified * 2.0)
        score += 8.0 if len(sentences) >= 4 else 0.0
        score += 8.0 if avg_len <= 220 else 0.0
        score += 6.0 if variance > 1500 else 0.0
        score = round(min(95.0, max(35.0, score)), 2)

        snippet = next((s for s in sentences if re.search(r"\b\d|%|\$|p95|p50", s, re.I)), None)
        if not snippet:
            snippet = sentences[0] if sentences else text[:160]

        return {
            "score": score,
            "explanation": "Communication is inferred from resume structure, quantified impact, and clarity markers.",
            "evidence": [
                {
                    "skill_name": "Communication",
                    "resume_text_snippet": snippet[:180],
                    "source_section": "Resume",
                    "confidence_score": 0.72,
                    "dimension": "communication",
                }
            ],
        }

    async def _match_communication(self, candidate: Candidate, job: JobPosting) -> dict[str, Any]:
        text = self._communication_text(candidate)
        if not text:
            return self._heuristic_communication("")

        prompt = f"""
Score the candidate's communication quality from 0 to 100 based on resume/profile text only.

Role: {job.title}

Candidate text:
{text[:12000]}

Return valid JSON with keys:
score (number), explanation (short string), evidence (list of snippets with skill_name, resume_text_snippet, source_section, confidence_score).
Focus on structure, clarity, quantified impact, and concise presentation.
"""
        try:
            result = openai_service.chat_json(prompt, temperature=0.2)
        except Exception:
            return self._heuristic_communication(text)

        try:
            score = float(result.get("score"))
        except (TypeError, ValueError):
            return self._heuristic_communication(text)

        evidence = result.get("evidence") or []
        if not isinstance(evidence, list) or not evidence:
            evidence = self._heuristic_communication(text)["evidence"]
        else:
            for item in evidence:
                if isinstance(item, dict):
                    item["dimension"] = "communication"
        return {
            "score": round(min(100.0, max(0.0, score)), 2),
            "explanation": str(result.get("explanation") or "Communication quality inferred from resume/profile text."),
            "evidence": evidence,
        }

    def _role_alignment_evidence(self, candidate: Candidate, job: JobPosting) -> list[dict[str, Any]]:
        evidence: list[dict[str, Any]] = []
        if candidate.experience:
            first = candidate.experience[0]
            snippet = self._to_text(first)[:180]
            evidence.append(
                {
                    "skill_name": "Experience",
                    "resume_text_snippet": snippet,
                    "source_section": "Experience",
                    "confidence_score": 0.78,
                    "dimension": "role_alignment",
                }
            )
        if candidate.education:
            first = candidate.education[0]
            snippet = self._to_text(first)[:180]
            evidence.append(
                {
                    "skill_name": "Education",
                    "resume_text_snippet": snippet,
                    "source_section": "Education",
                    "confidence_score": 0.7,
                    "dimension": "role_alignment",
                }
            )
        title_hint = self._title_alignment_score(candidate, job)
        evidence.append(
            {
                "skill_name": "Role fit",
                "resume_text_snippet": f"Job title/domain alignment scored at {title_hint} based on {job.title}.",
                "source_section": "Unknown",
                "confidence_score": round(title_hint / 100, 2),
                "dimension": "role_alignment",
            }
        )
        return evidence

    def _dimension_detail(
        self,
        *,
        score: float,
        explanation: str,
        evidence: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "score": round(float(score), 2),
            "explanation": explanation,
            "evidence": evidence,
        }

    async def rank_candidates(
        self,
        store: Store,
        job_id: UUID,
        weight_config: Optional[WeightConfig] = None,
        persist: bool = True,
        blind_mode: bool = False,
        source: Optional[str] = None,
        bench_priority: bool = False,
    ) -> list[dict[str, Any]]:
        job = store.jobs.get(job_id)
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

        candidates = store.candidates.query(lambda c: c.source == source) if source else store.candidates.list_all()
        weights = weight_config or DEFAULT_WEIGHTS
        scores: list[dict[str, Any]] = []

        for candidate in candidates:
            score = await self.score_candidate(candidate, job, weights)
            if persist:
                evaluation = self._upsert_evaluation(store, candidate, job, score, blind_mode)
                score["evaluation_id"] = evaluation.id
            if blind_mode:
                self._redact_identity(score, candidate)
            scores.append(score)

        if bench_priority:
            ranked = sorted(scores, key=lambda x: bench_sort_key(x["overall_score"], x.get("employment_status"), x["name"]))
        else:
            ranked = sorted(scores, key=lambda x: x["overall_score"], reverse=True)
        for idx, item in enumerate(ranked, start=1):
            item["rank"] = idx
        return ranked

    async def get_candidate_score(
        self,
        store: Store,
        candidate_id: UUID,
        job_id: Optional[UUID] = None,
    ) -> dict[str, Any]:
        candidate = store.candidates.get(candidate_id)
        if not candidate:
            return {"overall_score": 70.0, "missing_skills": []}
        if not job_id:
            jobs = store.jobs.list_all()
            if not jobs:
                return {"overall_score": 70.0, "missing_skills": []}
            job = jobs[0]
        else:
            job = store.jobs.get(job_id)
            if not job:
                return {"overall_score": 70.0, "missing_skills": []}
        return await self.score_candidate(candidate, job, DEFAULT_WEIGHTS)

    async def score_candidate(

        self,
        candidate: Candidate,
        job: JobPosting,
        weights: WeightConfig,
    ) -> dict[str, Any]:
        skill_score = await self._match_skills(candidate, job)
        exp_score = await self._match_experience(candidate, job)
        edu_score = await self._match_education(candidate, job)
        cert_score = await self._match_certifications(candidate, job)
        proj_score = await self._match_projects(candidate, job)
        communication = await self._match_communication(candidate, job)
        title_score = self._title_alignment_score(candidate, job)

        technical_score = self._normalize_weight(
            [skill_score, cert_score, proj_score],
            [weights.skills, weights.certifications, weights.projects],
        )
        role_alignment_score = self._normalize_weight(
            [exp_score, edu_score, title_score],
            [weights.experience, weights.education, 0.15],
        )

        total_weight = (
            (weights.skills + weights.certifications + weights.projects)
            + (weights.experience + weights.education)
            + weights.communication
        ) or 1.0

        overall = (
            technical_score * (weights.skills + weights.certifications + weights.projects)
            + role_alignment_score * (weights.experience + weights.education)
            + communication["score"] * weights.communication
        ) / total_weight

        explanation = await self._generate_explanation(
            candidate,
            job,
            {
                "skill_score": skill_score,
                "experience_score": exp_score,
                "education_score": edu_score,
                "certification_score": cert_score,
                "project_score": proj_score,
                "technical_skills_score": technical_score,
                "communication_score": communication["score"],
                "role_alignment_score": role_alignment_score,
                "overall_fit_score": round(float(overall), 2),
            },
        )

        technical_evidence = evidence_tracker.build_evidence(
            resume_text=candidate.resume_text or "",
            matched_skills=explanation.get("matched_skills") or [],
            experience=candidate.experience,
            projects=candidate.projects,
            dimension="technical_skills",
        )

        communication_evidence = communication["evidence"]
        role_evidence = self._role_alignment_evidence(candidate, job)
        overall_evidence = [*technical_evidence, *role_evidence, *communication_evidence]

        dimension_details = {
            "overall_fit": self._dimension_detail(
                score=round(float(overall), 2),
                explanation=explanation.get("overall_fit_explanation")
                or f"Overall fit combines technical skills ({technical_score}), role alignment ({role_alignment_score}), and communication ({communication['score']}).",
                evidence=overall_evidence,
            ),
            "technical_skills": self._dimension_detail(
                score=technical_score,
                explanation=explanation.get("technical_skills_explanation")
                or f"Technical skill evidence comes from skills, certifications, and projects; higher is better when those scores are stronger.",
                evidence=technical_evidence,
            ),
            "communication": self._dimension_detail(
                score=communication["score"],
                explanation=communication["explanation"],
                evidence=communication_evidence,
            ),
            "role_alignment": self._dimension_detail(
                score=role_alignment_score,
                explanation=explanation.get("role_alignment_explanation")
                or f"Role alignment combines experience, education, and job-title/domain similarity (title match score {title_score}).",
                evidence=role_evidence,
            ),
        }

        return {
            "candidate_id": candidate.id,
            "name": candidate.name,
            "email": candidate.email,
            "years_of_experience": candidate.years_of_experience(),
            "skills": [str(s) for s in (candidate.skills or [])],
            "overall_score": round(float(overall), 2),
            "skill_score": skill_score,
            "experience_score": exp_score,
            "education_score": edu_score,
            "certification_score": cert_score,
            "project_score": proj_score,
            "technical_skills_score": technical_score,
            "communication_score": communication["score"],
            "role_alignment_score": role_alignment_score,
            "matched_skills": explanation.get("matched_skills") or [],
            "missing_skills": explanation.get("missing_skills") or [],
            "strengths": explanation.get("strengths"),
            "weaknesses": explanation.get("weaknesses"),
            "transferable_skills": explanation.get("transferable_skills"),
            "evidence": overall_evidence,
            "dimensions": dimension_details,
            "source": candidate.source,
            "employment_status": candidate.employment_status,
            "current_assignment": candidate.current_assignment,
        }

    async def get_candidate_score(
        self,
        store: Store,
        candidate_id: UUID,
        job_id: UUID,
        weight_config: Optional[WeightConfig] = None,
        persist: bool = True,
        blind_mode: bool = False,
    ) -> dict[str, Any]:
        candidate = store.candidates.get(candidate_id)
        job = store.jobs.get(job_id)
        if not candidate:
            raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

        score = await self.score_candidate(candidate, job, weight_config or DEFAULT_WEIGHTS)
        if persist:
            evaluation = self._upsert_evaluation(store, candidate, job, score, blind_mode)
            score["evaluation_id"] = evaluation.id
        if blind_mode:
            self._redact_identity(score, candidate)
        return score

    @staticmethod
    def _redact_identity(score: dict[str, Any], candidate: Candidate) -> None:
        """Blind review mode: strip real name/email from a score payload before
        it can reach a UI or an LLM prompt (comparison narratives, agent chat).

        Evidence snippets and free-text explanations quote the resume verbatim,
        which usually opens with the candidate's name, so name/email alone
        isn't enough — scrub the name out of every text field too.
        """
        name = candidate.name
        score["name"] = f"Candidate-{str(candidate.id)[:8]}"
        score["email"] = None
        for field in ("strengths", "weaknesses", "transferable_skills"):
            if score.get(field):
                score[field] = redact_name(score[field], name)
        for item in score.get("evidence") or []:
            if isinstance(item, dict) and item.get("resume_text_snippet"):
                item["resume_text_snippet"] = redact_name(item["resume_text_snippet"], name)

    async def _match_skills(self, candidate: Candidate, job: JobPosting) -> float:
        candidate_skills = [str(s) for s in (candidate.skills or [])]
        required = [str(s) for s in (job.required_skills or [])]
        skills_text = " ".join(candidate_skills).lower()
        resume_text = (candidate.resume_text or skills_text).lower()
        keyword_scores = [
            keyword_signal([normalize_skill(s)], skills_text, resume_text)["score"]
            for s in required
        ]
        keyword = sum(keyword_scores) / len(keyword_scores) if keyword_scores else self._jaccard(candidate_skills, required)
        semantic_scores = []
        for skill in required:
            sem = semantic_signal(skill, skills_text)
            if sem is not None:
                semantic_scores.append(sem)
        semantic = (
            sum(semantic_scores) / len(semantic_scores)
            if semantic_scores
            else search_service.semantic_skill_overlap(candidate_skills, required)
        )
        nice = [str(s) for s in (job.nice_to_have_skills or [])]
        nice_bonus = 0.0
        if nice:
            nice_overlap = self._jaccard(candidate_skills, nice)
            nice_bonus = nice_overlap * 0.1
        blended = blend_signals(float(keyword), float(semantic), None)
        return round(min(100.0, blended + nice_bonus), 2)

    async def _match_experience(self, candidate: Candidate, job: JobPosting) -> float:
        years = candidate.years_of_experience()
        required = job.required_experience_years or 0
        if required <= 0:
            return 80.0 if years > 0 else 50.0
        ratio = years / required
        if ratio >= 1:
            return 100.0
        if ratio >= 0.75:
            return 85.0
        if ratio >= 0.5:
            return 65.0
        return round(max(20.0, ratio * 100), 2)

    async def _match_education(self, candidate: Candidate, job: JobPosting) -> float:
        education = candidate.education or []
        requirement = (job.education_requirements or "").lower()
        if not requirement:
            return 75.0 if education else 50.0
        blob = json.dumps(education).lower()
        keywords = ["bachelor", "master", "phd", "bsc", "msc", "computer", "degree"]
        hits = sum(1 for k in keywords if k in requirement and k in blob)
        if hits >= 2:
            return 95.0
        if hits == 1 or education:
            return 70.0
        return 40.0

    async def _match_certifications(self, candidate: Candidate, job: JobPosting) -> float:
        certs = [str(c).lower() for c in (candidate.certifications or [])]
        if not certs:
            return 40.0
        required = " ".join([str(s).lower() for s in (job.required_skills or [])])
        overlap = sum(1 for c in certs if any(token in c for token in required.split() if len(token) > 2))
        if overlap:
            return min(100.0, 60.0 + overlap * 15)
        return 55.0

    async def _match_projects(self, candidate: Candidate, job: JobPosting) -> float:
        projects = candidate.projects or []
        if not projects:
            return 35.0
        required = {normalize_skill(s) for s in (job.required_skills or [])}
        hits = 0
        for project in projects:
            text = json.dumps(project).lower() if not isinstance(project, str) else project.lower()
            hits += sum(1 for skill in required if skill and skill in text)
        if not required:
            return 70.0
        return round(min(100.0, (hits / max(len(required), 1)) * 100), 2)

    async def _generate_explanation(
        self,
        candidate: Candidate,
        job: JobPosting,
        scores: dict[str, float],
    ) -> dict[str, Any]:
        prompt = f"""
A recruiter evaluated candidate {candidate.name} for the role of {job.title}.

Candidate Profile:
- Skills: {candidate.skills}
- Experience: {candidate.experience}
- Education: {candidate.education}
- Certifications: {candidate.certifications}
- Projects: {candidate.projects}

Job Requirements:
- Required Skills: {job.required_skills}
- Nice to have: {job.nice_to_have_skills}
- Years Required: {job.required_experience_years}
- Education: {job.education_requirements}

Scores:
- Skill Match: {scores['skill_score']}/100
- Experience Match: {scores['experience_score']}/100
- Education Match: {scores['education_score']}/100
- Certification Match: {scores['certification_score']}/100
- Project Match: {scores['project_score']}/100
- Technical Skills: {scores['technical_skills_score']}/100
- Communication: {scores['communication_score']}/100
- Role Alignment: {scores['role_alignment_score']}/100
- Overall Fit: {scores['overall_fit_score']}/100

Generate JSON with keys:
matched_skills (list of {{skill, source}}),
missing_skills (list),
strengths (string),
weaknesses (string),
transferable_skills (string),
technical_skills_explanation (string),
communication_explanation (string),
role_alignment_explanation (string),
overall_fit_explanation (string),
dimensions (object with the four keys above containing short explanations).
"""
        result = openai_service.chat_json(prompt, temperature=0.3)

        # Deterministic fallbacks when model output is incomplete
        cand_skills = {normalize_skill(str(s)): str(s) for s in (candidate.skills or [])}
        req_skills = [str(s) for s in (job.required_skills or [])]
        matched = result.get("matched_skills")
        missing = result.get("missing_skills")
        if not matched:
            matched = [
                {"skill": skill, "source": "Skills"}
                for skill in req_skills
                if normalize_skill(skill) in cand_skills
            ]
        if not missing:
            missing = [
                skill for skill in req_skills if normalize_skill(skill) not in cand_skills
            ]
        result["matched_skills"] = matched
        result["missing_skills"] = missing
        return result

    def _upsert_evaluation(
        self,
        store: Store,
        candidate: Candidate,
        job: JobPosting,
        score: dict[str, Any],
        blind_mode: bool,
    ) -> Evaluation:
        evaluation = store.evaluations.get_for(job.id, candidate.id)
        strengths = score.get("strengths")
        weaknesses = score.get("weaknesses")
        transferable = score.get("transferable_skills")
        evidence = score.get("evidence") or []
        if blind_mode:
            strengths = redact_name(redact_pii(strengths or ""), candidate.name)
            weaknesses = redact_name(redact_pii(weaknesses or ""), candidate.name)
            transferable = redact_name(redact_pii(transferable or ""), candidate.name)
            evidence = [
                {
                    **item,
                    "resume_text_snippet": redact_name(
                        item.get("resume_text_snippet") or "", candidate.name
                    ),
                }
                if isinstance(item, dict) and item.get("resume_text_snippet")
                else item
                for item in evidence
            ]

        payload = dict(
            overall_score=Decimal(str(score["overall_score"])),
            skill_match_score=Decimal(str(score["skill_score"])),
            experience_match_score=Decimal(str(score["experience_score"])),
            education_match_score=Decimal(str(score["education_score"])),
            certification_match_score=Decimal(str(score["certification_score"])),
            project_match_score=Decimal(str(score["project_score"])),
            matched_skills=score.get("matched_skills"),
            missing_skills=score.get("missing_skills"),
            strengths=strengths,
            weaknesses=weaknesses,
            transferable_skills=transferable,
            blind_review_mode=blind_mode,
        )

        is_rescore = evaluation is not None
        if evaluation:
            for key, value in payload.items():
                setattr(evaluation, key, value)
            store.evidence.delete_for_evaluation(evaluation.id)
        else:
            evaluation = Evaluation(candidate_id=candidate.id, job_id=job.id, **payload)

        # Primary domain write — must succeed; propagates on failure.
        store.evaluations.save(evaluation)

        evidence_tracker.persist(store, evaluation.id, evidence)

        # Secondary write — best-effort (log_history_event swallows its own failures).
        handoff_service.log_history_event(
            store,
            candidate_id=str(candidate.id),
            candidate_name=candidate.name,
            job_id=str(job.id),
            job_title=job.title,
            event_type="evaluation_updated" if is_rescore else "evaluation_created",
            summary=(
                f"{'Re-scored' if is_rescore else 'Scored'} against {job.title} — "
                f"overall {score['overall_score']}/100"
            ),
            details={
                "evaluation_id": str(evaluation.id),
                "overall_score": score["overall_score"],
                "skill_score": score["skill_score"],
                "experience_score": score["experience_score"],
                "education_score": score["education_score"],
                "certification_score": score["certification_score"],
                "project_score": score["project_score"],
                "blind_review_mode": blind_mode,
            },
        )
        return evaluation

    @staticmethod
    def _jaccard(a: list[str], b: list[str]) -> float:
        if not b:
            return 100.0
        sa = {normalize_skill(x) for x in a if x}
        sb = {normalize_skill(x) for x in b if x}
        if not sb:
            return 100.0
        return round((len(sa & sb) / len(sb)) * 100, 2)


candidate_matcher = CandidateMatcher()


async def get_candidate_score(
    store: Store,
    candidate_id: UUID,
    job_id: Optional[UUID] = None,
) -> dict[str, Any]:
    return await candidate_matcher.get_candidate_score(store, candidate_id, job_id)

