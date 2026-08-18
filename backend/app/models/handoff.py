import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class CandidateHistoryEvent(BaseModel):
    """Append-only log of everything that happens to a candidate's evaluation.

    candidate_id is a plain string (not a foreign key), matching
    CandidateDecision, because the ranking/compare pages can show candidates
    that only exist client-side (demo/mock dataset), not just candidates
    persisted in the store. Evaluations are upserted (re-scoring overwrites
    the blob), so this log is the only place a point-in-time history
    survives.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    candidate_id: str
    candidate_name: Optional[str] = None
    job_id: Optional[str] = None
    job_title: Optional[str] = None
    event_type: str
    actor_email: Optional[str] = None
    summary: Optional[str] = None
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=_utcnow)


class InterviewHandoff(BaseModel):
    """A candidate summary briefing handed off to a technical interviewer."""

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    candidate_id: str
    candidate_name: str
    candidate_email: Optional[str] = None
    job_id: Optional[str] = None
    job_title: Optional[str] = None
    interviewer_name: str
    interviewer_email: str
    created_by: Optional[str] = None
    briefing: dict[str, Any] = Field(default_factory=dict)
    status: str = "pending"
    interviewer_notes: Optional[str] = None
    email_sent: bool = False
    email_source: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    viewed_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
