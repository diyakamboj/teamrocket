from collections import Counter
from typing import Any
from uuid import UUID

from app.services.azure_services import openai_service
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError


class HiringInsightsService:
    async def get_insights(self, store: Store, job_id: UUID) -> dict[str, Any]:
        job = store.jobs.get(job_id)
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

        evaluations = store.evaluations.list_for_job(job_id)
        candidates = store.candidates.list_all()

        skill_counter: Counter[str] = Counter()
        missing_counter: Counter[str] = Counter()
        for candidate in candidates:
            for skill in candidate.skills or []:
                skill_counter[str(skill)] += 1
        for evaluation in evaluations:
            for skill in evaluation.missing_skills or []:
                if isinstance(skill, dict):
                    missing_counter[str(skill.get("skill") or skill.get("skill_name"))] += 1
                else:
                    missing_counter[str(skill)] += 1

        scores = [float(e.overall_score) for e in evaluations if e.overall_score is not None]
        avg_score = round(sum(scores) / len(scores), 2) if scores else 0.0
        avg_exp = (
            round(sum(c.years_of_experience() for c in candidates) / len(candidates), 2)
            if candidates
            else 0.0
        )

        top_skills = [{"skill": s, "count": c} for s, c in skill_counter.most_common(10)]
        common_missing = [{"skill": s, "count": c} for s, c in missing_counter.most_common(10)]

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
        }

    async def get_distribution(self, store: Store, job_id: UUID) -> dict[str, Any]:
        job = store.jobs.get(job_id)
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

        evaluations = store.evaluations.list_for_job(job_id)
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
        candidates = store.candidates.list_all()
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
        }


hiring_insights = HiringInsightsService()
