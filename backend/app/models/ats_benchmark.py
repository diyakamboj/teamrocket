import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AtsBenchmarkScore(BaseModel):
    """Dual-scoring result: keyword-matching ATS baseline vs LLM semantic fit.

    One document per Evaluation (upserted on recompute, keyed by
    evaluation_id), so re-running the benchmark after a resume update or
    re-score replaces the prior result rather than accumulating stale
    duplicates.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    evaluation_id: uuid.UUID
    candidate_id: uuid.UUID
    job_id: uuid.UUID

    keyword_score: Decimal
    matched_keywords: list[Any] = Field(default_factory=list)
    missing_keywords: list[Any] = Field(default_factory=list)

    semantic_score: Decimal
    semantic_rationale: str | None = None
    equivalent_terms: list[Any] = Field(default_factory=list)

    score_delta: Decimal
    verdict: str  # semantic_stronger | keyword_stronger | aligned

    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
