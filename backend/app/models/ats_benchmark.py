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

    # None when the job lists no skills to scan for -- see the service.
    keyword_score: Decimal | None = None
    matched_keywords: list[Any] = Field(default_factory=list)
    missing_keywords: list[Any] = Field(default_factory=list)
    #: Missing keywords split by tier, so the UI can say which gaps are
    #: disqualifying rather than listing every gap at equal weight.
    missing_required: list[Any] = Field(default_factory=list)
    missing_nice_to_have: list[Any] = Field(default_factory=list)
    #: Share of the job's *required* skills found, independent of the
    #: weighted score. None when the job lists no required skills.
    required_coverage_pct: Decimal | None = None
    meets_required: bool = False

    semantic_score: Decimal | None = None  # None when the model gave no usable score
    semantic_rationale: str | None = None
    equivalent_terms: list[Any] = Field(default_factory=list)

    score_delta: Decimal | None = None  # None unless both scores exist
    verdict: str  # semantic_stronger | keyword_stronger | aligned
    #          | no_keyword_baseline | semantic_unavailable

    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
