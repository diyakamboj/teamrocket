import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


class JDRecommendationRecord(Base):
    """Persisted recruiter decision for a JD calibration recommendation.

    Live coverage numbers are recomputed on each GET; status is matched on
    (job_id, skill_key) so a prior accept/reject/modify is not reset.
    """

    __tablename__ = "jd_recommendations"
    __table_args__ = (
        UniqueConstraint("job_id", "skill_key", name="uq_jd_recommendation_job_skill"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_postings.id"), nullable=False, index=True
    )
    skill: Mapped[str] = mapped_column(String(255), nullable=False)
    skill_key: Mapped[str] = mapped_column(String(255), nullable=False)
    classification: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    suggested_modification: Mapped[Optional[str]] = mapped_column(Text)
    recruiter_note: Mapped[Optional[str]] = mapped_column(Text)
    supporting_data: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType, default=dict)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False))
    decided_by: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), onupdate=func.now()
    )

    job = relationship("JobPosting")
