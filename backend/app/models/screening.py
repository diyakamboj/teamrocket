import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, Integer, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


class ScreeningSession(Base):
    """A Level 1 preliminary screening conversation.

    candidate_id is a plain string (not an FK) for the same reason
    CandidateDecision uses one: screening can be run on candidates that only
    exist client-side (demo/mock rows), not just rows in the candidates table.
    When it *is* a candidates.id, `evaluation_id` is set too and screening
    results are written back onto that evaluation as evidence.
    """

    __tablename__ = "screening_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[str] = mapped_column(String(255), index=True)
    candidate_name: Mapped[str] = mapped_column(String(255))
    job_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, index=True)
    job_title: Mapped[Optional[str]] = mapped_column(String(255))
    evaluation_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid)
    recruiter_email: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    status: Mapped[str] = mapped_column(String(20), default="in_progress", index=True)

    #: Generated question plan — list of ScreeningQuestion dicts.
    plan: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    #: Conversation so far — list of turn dicts (question + answer + evaluation).
    turns: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    #: Index into `plan` of the question awaiting an answer.
    current_index: Mapped[int] = mapped_column(Integer, default=0)
    #: Candidate/job context the plan was generated from, kept for auditability.
    context: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType, default=dict)
    #: Aggregate scorecard once enough answers exist.
    scorecard: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType, default=dict)
    #: Pre-interview briefing, generated on completion.
    briefing: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), onupdate=func.now()
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False))
