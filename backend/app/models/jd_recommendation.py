import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class JDRecommendationRecord(BaseModel):
    """Persisted recruiter decision for a JD calibration recommendation.

    Live coverage numbers are recomputed on each GET; status is matched on
    (job_id, skill_key) so a prior accept/reject/modify is not reset.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    job_id: uuid.UUID
    skill: str
    skill_key: str
    classification: str
    status: str = "pending"
    suggested_modification: Optional[str] = None
    recruiter_note: Optional[str] = None
    supporting_data: dict[str, Any] = Field(default_factory=dict)
    decided_at: Optional[datetime] = None
    decided_by: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
