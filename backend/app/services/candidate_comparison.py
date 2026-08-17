from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.schemas import WeightConfig
from app.services.azure_services import openai_service
from app.services.candidate_matcher import candidate_matcher
from app.utils.error_handlers import ValidationAppError


class CandidateComparisonService:
    async def compare(
        self,
        db: Session,
        job_id: UUID,
        candidate_ids: list[UUID],
        weights: WeightConfig | None = None,
    ) -> dict[str, Any]:
        if len(candidate_ids) < 2:
            raise ValidationAppError("At least two candidates are required for comparison")

        scored: list[dict[str, Any]] = []
        for cid in candidate_ids:
            score = await candidate_matcher.get_candidate_score(
                db, cid, job_id, weight_config=weights, persist=True
            )
            scored.append(score)

        scored = sorted(scored, key=lambda x: x["overall_score"], reverse=True)
        for idx, item in enumerate(scored, start=1):
            item["rank"] = idx

        prompt = f"""
Compare these {len(scored)} candidates for job_id={job_id}.

Candidates and scores:
{scored}

    For each candidate, also consider the dimension scores and explanations when comparing:
    - overall_fit
    - technical_skills
    - communication
    - role_alignment

Provide a detailed comparison highlighting:
1. Relative strengths
2. Skill gaps for each
3. Best fit recommendation with reasoning
4. Interview focus areas for each candidate
"""
        comparison = openai_service.chat_text(prompt, temperature=0.5, max_tokens=1400)
        return {
            "job_id": job_id,
            "comparison": comparison,
            "candidates": scored,
            "candidates_compared": candidate_ids,
        }


candidate_comparison = CandidateComparisonService()
