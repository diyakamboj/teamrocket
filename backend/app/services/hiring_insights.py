from collections import Counter
from typing import Any
from uuid import UUID

from app.services.analytics_scope import job_evaluated_population
from app.services.azure_services import openai_service
from app.services.jd_optimizer import LOW_SCORE_CUTOFF, jd_optimizer
from app.services.job_pipeline_service import job_candidate_sources, job_pipeline_progression
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError
from app.utils.validators import has_normalized_skill, normalized_skill_set, skill_text


class HiringInsightsService:
    def _skill_coverage(self, job, evaluations, candidates_by_id) -> list[dict[str, Any]]:
        """Drop-off attribution per required/nice-to-have skill.

        Population: job-scoped evaluated candidates. Coverage uses the same
        normalize_skill membership as CandidateMatcher._jaccard.
        """
        total = len(evaluations)
        if total == 0:
            return []

        ordered: list[tuple[str, bool]] = []
        seen: set[str] = set()
        for raw, is_must in (
            *[(skill, True) for skill in (job.required_skills or [])],
            *[(skill, False) for skill in (job.nice_to_have_skills or [])],
        ):
            skill = skill_text(raw)
            key = skill.lower().strip()
            if not skill or key in seen:
                continue
            seen.add(key)
            ordered.append((skill, is_must))

        coverage: list[dict[str, Any]] = []
        for skill, is_must in ordered:
            matching = 0
            low_without = 0
            for evaluation in evaluations:
                candidate = candidates_by_id.get(evaluation.candidate_id)
                if not candidate:
                    continue
                if has_normalized_skill(skill, normalized_skill_set(candidate.skills)):
                    matching += 1
                    continue
                score = float(evaluation.overall_score) if evaluation.overall_score is not None else 0.0
                if score < LOW_SCORE_CUTOFF:
                    low_without += 1
            coverage.append(
                {
                    "skill": skill,
                    "is_must_have": is_must,
                    "coverage_pct": round((matching / total) * 100, 2) if total else 0.0,
                    "candidates_matching": matching,
                    "total_candidates": total,
                    "low_score_without_skill_pct": round((low_without / total) * 100, 2)
                    if total
                    else 0.0,
                }
            )
        return coverage

    async def get_insights(self, store: Store, job_id: UUID) -> dict[str, Any]:
        job = store.jobs.get(job_id)
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

        evaluations, candidates, candidates_by_id = job_evaluated_population(store, job_id)

        skill_counter: Counter[str] = Counter()
        missing_counter: Counter[str] = Counter()
        for candidate in candidates:
            for skill in candidate.skills or []:
                text = skill_text(skill)
                if text:
                    skill_counter[text] += 1
        for evaluation in evaluations:
            for skill in evaluation.missing_skills or []:
                text = skill_text(skill)
                if text:
                    missing_counter[text] += 1

        scores = [float(e.overall_score) for e in evaluations if e.overall_score is not None]
        avg_score = round(sum(scores) / len(scores), 2) if scores else 0.0
        avg_exp = (
            round(sum(c.years_of_experience() for c in candidates) / len(candidates), 2)
            if candidates
            else 0.0
        )

        top_skills = [{"skill": s, "count": c} for s, c in skill_counter.most_common(10)]
        common_missing = [{"skill": s, "count": c} for s, c in missing_counter.most_common(10)]
        skill_coverage = self._skill_coverage(job, evaluations, candidates_by_id)
        pipeline_progression = job_pipeline_progression(store, job_id)
        candidate_sources = job_candidate_sources(candidates)

        jd_optimization = await jd_optimizer.get_optimization(store, job_id, include_summary=False)
        jd_recommendations = jd_optimization.get("recommendations", [])
        jd_top_flag = next(
            (
                item["classification"]
                for item in jd_recommendations
                if item["classification"]
                in {"too_strict", "under_filtered", "low_signal", "insufficient_data"}
            ),
            None,
        )

        prompt = f"""
Write a short recruiter-facing summary of qualification gaps for role '{job.title}'.
Required skills: {job.required_skills}
Common missing skills: {common_missing[:5]}
Average match score: {avg_score}
Keep it under 80 words.
"""
        gaps_summary = openai_service.chat_text(prompt, temperature=0.4, max_tokens=220)

        pipeline = {
            "total_candidates": len(candidates),
            "evaluated": len(evaluations),
            "high_fit": sum(1 for s in scores if s >= 85),
            "medium_fit": sum(1 for s in scores if 55 <= s < 85),
            "low_fit": sum(1 for s in scores if s < 55),
        }

        return {
            "job_id": job_id,
            "total_candidates": len(candidates),
            "evaluated_candidates": len(evaluations),
            "average_score": avg_score,
            "top_skills": top_skills,
            "common_missing_skills": common_missing,
            "average_experience_years": avg_exp,
            "qualification_gaps_summary": gaps_summary,
            "pipeline_status": pipeline,
            "pipeline_progression": pipeline_progression,
            "candidate_sources": candidate_sources,
            "skill_coverage": skill_coverage,
            "jd_suggestions_count": len(jd_recommendations),
            "jd_top_flag": jd_top_flag,
        }

    async def get_distribution(self, store: Store, job_id: UUID) -> dict[str, Any]:
        job = store.jobs.get(job_id)
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

        evaluations, candidates, _candidates_by_id = job_evaluated_population(store, job_id)
        scores = [float(e.overall_score) for e in evaluations if e.overall_score is not None]

        buckets = [
            ("0-40", 0, 40),
            ("40-55", 40, 55),
            ("55-70", 55, 70),
            ("70-85", 70, 85),
            ("85-100", 85, 101),
        ]
        distribution = [
            {"bucket": label, "count": sum(1 for s in scores if lo <= s < hi)}
            for label, lo, hi in buckets
        ]

        levels = {"Junior": 0, "Mid": 0, "Senior": 0, "Lead": 0}
        for candidate in candidates:
            years = candidate.years_of_experience()
            if years < 3:
                levels["Junior"] += 1
            elif years < 7:
                levels["Mid"] += 1
            elif years < 12:
                levels["Senior"] += 1
            else:
                levels["Lead"] += 1

        return {
            "job_id": job_id,
            "score_distribution": distribution,
            "experience_levels": levels,
            "pipeline_progression": job_pipeline_progression(store, job_id),
            "candidate_sources": job_candidate_sources(candidates),
        }


hiring_insights = HiringInsightsService()
