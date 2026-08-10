import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


class AtsBenchmarkScore(Base):
    """Dual-scoring result: keyword-matching ATS baseline vs LLM semantic fit.

    One row per Evaluation (upserted on recompute), so re-running the
    benchmark after a resume update or re-score replaces the prior result
    rather than accumulating stale duplicates.
    """

    __tablename__ = "ats_benchmark_scores"
    __table_args__ = (UniqueConstraint("evaluation_id", name="uq_ats_benchmark_evaluation"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    evaluation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("evaluations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("candidates.id"), nullable=False, index=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_postings.id"), nullable=False, index=True
    )

    keyword_score: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    matched_keywords: Mapped[list[Any]] = mapped_column(JSONType, default=list)
    missing_keywords: Mapped[list[Any]] = mapped_column(JSONType, default=list)

    semantic_score: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    semantic_rationale: Mapped[Optional[str]] = mapped_column(Text)
    equivalent_terms: Mapped[list[Any]] = mapped_column(JSONType, default=list)

    score_delta: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    verdict: Mapped[str] = mapped_column(String(30))  # semantic_stronger | keyword_stronger | aligned

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), onupdate=func.now()
    )
