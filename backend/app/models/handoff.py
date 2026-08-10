import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


def _utcnow() -> datetime:
    # Python-side default (microsecond precision, evaluated per-row at flush)
    # rather than server_default=func.now(), which resolves to a single
    # per-transaction timestamp in Postgres and second-resolution in SQLite —
    # both of which collapse multiple events written in one commit to the
    # same created_at, breaking chronological ordering of the history log.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class CandidateHistoryEvent(Base):
    """Append-only log of everything that happens to a candidate's evaluation.

    candidate_id is a plain string (not an FK), matching CandidateDecision,
    because the ranking/compare pages can show candidates that only exist
    client-side (demo/mock dataset), not just rows in the candidates table.
    Evaluations are upserted (re-scoring overwrites the row), so this table
    is the only place a point-in-time history survives.
    """

    __tablename__ = "candidate_history_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[str] = mapped_column(String(255), index=True)
    candidate_name: Mapped[Optional[str]] = mapped_column(String(255))
    job_id: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    job_title: Mapped[Optional[str]] = mapped_column(String(255))
    event_type: Mapped[str] = mapped_column(String(50), index=True)
    actor_email: Mapped[Optional[str]] = mapped_column(String(255))
    summary: Mapped[Optional[str]] = mapped_column(Text)
    details: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=_utcnow, server_default=func.now(), index=True
    )


class InterviewHandoff(Base):
    """A candidate summary briefing handed off to a technical interviewer."""

    __tablename__ = "interview_handoffs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[str] = mapped_column(String(255), index=True)
    candidate_name: Mapped[str] = mapped_column(String(255))
    candidate_email: Mapped[Optional[str]] = mapped_column(String(255))
    job_id: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    job_title: Mapped[Optional[str]] = mapped_column(String(255))
    interviewer_name: Mapped[str] = mapped_column(String(255))
    interviewer_email: Mapped[str] = mapped_column(String(255), index=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    briefing: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    interviewer_notes: Mapped[Optional[str]] = mapped_column(Text)
    email_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    email_source: Mapped[Optional[str]] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), default=_utcnow, server_default=func.now(), index=True
    )
    viewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False))
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=False))
