import json
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.candidate import Candidate
from app.models.evaluation import Evaluation
from app.models.job_posting import JobPosting
from app.models.schemas import WeightConfig
from app.services.azure_services import openai_service, search_service
from app.services.badge_service import build_badges
from app.services.evidence_tracker import SCREENING_EVIDENCE_SECTION, evidence_tracker
from app.utils.error_handlers import NotFoundError
from app.utils.validators import normalize_skill, redact_pii


DEFAULT_WEIGHTS = WeightConfig()


class CandidateMatcher:
    async def rank_candidates(
        self,
        db: Session,
        job_id: UUID,
        weight_config: Optional[WeightConfig] = None,
        persist: bool = True,
        blind_mode: bool = False,
    ) -> list[dict[str, Any]]:
        job = db.get(JobPosting, job_id)
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

        candidates = db.query(Candidate).all()
        weights = weight_config or DEFAULT_WEIGHTS
        scores: list[dict[str, Any]] = []

        for candidate in candidates:
            score = await self.score_candidate(candidate, job, weights)
            if persist:
                evaluation = self._upsert_evaluation(db, candidate, job, score, blind_mode)
                score["evaluation_id"] = evaluation.id
            if blind_mode:
                score["name"] = f"Candidate-{str(candidate.id)[:8]}"
                score["email"] = None
                self._redact_badges(score)
            scores.append(score)

        if persist:
            db.commit()

        ranked = sorted(scores, key=lambda x: x["overall_score"], reverse=True)
        for idx, item in enumerate(ranked, start=1):
            item["rank"] = idx
        return ranked

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

        total_weight = (
            weights.skills
            + weights.experience
            + weights.education
            + weights.certifications
            + weights.projects
        ) or 1.0

        overall = (
            skill_score * weights.skills
            + exp_score * weights.experience
            + edu_score * weights.education
            + cert_score * weights.certifications
            + proj_score * weights.projects
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
            },
        )

        evidence = explanation.get("evidence") or evidence_tracker.build_evidence(
            resume_text=candidate.resume_text or "",
            matched_skills=explanation.get("matched_skills") or [],
            experience=candidate.experience,
            projects=candidate.projects,
        )

        score = {
            "candidate_id": candidate.id,
            "name": candidate.name,
            "email": candidate.email,
            "overall_score": round(float(overall), 2),
            "skill_score": skill_score,
            "experience_score": exp_score,
            "education_score": edu_score,
            "certification_score": cert_score,
            "project_score": proj_score,
            "matched_skills": explanation.get("matched_skills") or [],
            "missing_skills": explanation.get("missing_skills") or [],
            "strengths": explanation.get("strengths"),
            "weaknesses": explanation.get("weaknesses"),
            "transferable_skills": explanation.get("transferable_skills"),
            "evidence": evidence,
        }
        score.update(build_badges(candidate, score).as_dict())
        return score

    async def get_candidate_score(
        self,
        db: Session,
        candidate_id: UUID,
        job_id: UUID,
        weight_config: Optional[WeightConfig] = None,
        persist: bool = True,
    ) -> dict[str, Any]:
        candidate = db.get(Candidate, candidate_id)
        job = db.get(JobPosting, job_id)
        if not candidate:
            raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

        score = await self.score_candidate(candidate, job, weight_config or DEFAULT_WEIGHTS)
        if persist:
            evaluation = self._upsert_evaluation(db, candidate, job, score, False)
            score["evaluation_id"] = evaluation.id
            db.commit()
        return score

    async def _match_skills(self, candidate: Candidate, job: JobPosting) -> float:
        candidate_skills = [str(s) for s in (candidate.skills or [])]
        required = [str(s) for s in (job.required_skills or [])]
        keyword = self._jaccard(candidate_skills, required)
        semantic = search_service.semantic_skill_overlap(candidate_skills, required)
        nice = [str(s) for s in (job.nice_to_have_skills or [])]
        nice_bonus = 0.0
        if nice:
            nice_overlap = self._jaccard(candidate_skills, nice)
            nice_bonus = nice_overlap * 0.1
        return round(min(100.0, (keyword * 0.55 + semantic * 0.45) + nice_bonus), 2)

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

Generate JSON with keys:
matched_skills (list of {{skill, source}}),
missing_skills (list),
strengths (string),
weaknesses (string),
transferable_skills (string),
evidence (list of {{skill_name, resume_text_snippet, source_section, confidence_score}}).
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
        db: Session,
        candidate: Candidate,
        job: JobPosting,
        score: dict[str, Any],
        blind_mode: bool,
    ) -> Evaluation:
        evaluation = (
            db.query(Evaluation)
            .filter(Evaluation.candidate_id == candidate.id, Evaluation.job_id == job.id)
            .first()
        )
        strengths = score.get("strengths")
        weaknesses = score.get("weaknesses")
        transferable = score.get("transferable_skills")
        if blind_mode:
            strengths = redact_pii(strengths or "")
            weaknesses = redact_pii(weaknesses or "")
            transferable = redact_pii(transferable or "")

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

        if evaluation:
            for key, value in payload.items():
                setattr(evaluation, key, value)
            for item in list(evaluation.evidence_items):
                # Screening evidence comes from a conversation, not the resume,
                # so re-ranking must not discard it along with its own output.
                if item.source_section != SCREENING_EVIDENCE_SECTION:
                    db.delete(item)
        else:
            evaluation = Evaluation(candidate_id=candidate.id, job_id=job.id, **payload)
            db.add(evaluation)
        db.flush()

        evidence_tracker.persist(db, evaluation.id, score.get("evidence") or [])
        return evaluation

    @staticmethod
    def _redact_badges(score: dict[str, Any]) -> None:
        """Badge evidence quotes the resume verbatim, so it needs the same
        PII masking as the written explanations under blind review."""
        for badge in [*score.get("status_flags", []), *score.get("skill_badges", [])]:
            if badge.get("reason"):
                badge["reason"] = redact_pii(badge["reason"])
            for item in badge.get("evidence") or []:
                item["detail"] = redact_pii(item.get("detail") or "")
                item["url"] = None

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
