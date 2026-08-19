"""Sharing and messaging between connected recruiters.

Both are gated on an accepted connection: you can only share a candidate with,
or message, someone who has agreed to connect. A share is read-only and
revocable — it never moves ownership of the candidate.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class CandidateShare(BaseModel):
    """One candidate, shared by its owner with one connected recruiter."""

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    candidate_id: uuid.UUID
    owner_email: str
    shared_with_email: str
    #: Why it was shared — shown alongside the candidate for the recipient.
    note: Optional[str] = None
    #: Job the sharing recruiter was working the candidate for, if any.
    job_id: Optional[uuid.UUID] = None
    job_title: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)


class SharedCandidateView(BaseModel):
    """A shared candidate as the recipient sees it: enough to judge fit,
    without inheriting the record."""

    share_id: uuid.UUID
    candidate_id: uuid.UUID
    name: str
    title: Optional[str] = None
    location: Optional[str] = None
    skills: list[str] = Field(default_factory=list)
    shared_by_email: str
    shared_by_name: str
    note: Optional[str] = None
    job_title: Optional[str] = None
    #: Screening outcome if the owner has screened them, so the recipient sees
    #: the evidence rather than a name.
    screening_summary: Optional[str] = None
    screening_score: Optional[float] = None
    created_at: datetime


class DirectMessage(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    #: Sorted pair of emails — the conversation key, so both sides read the
    #: same thread regardless of who started it.
    thread_key: str
    sender_email: str
    recipient_email: str
    body: str
    #: Set when a share is discussed in the thread, so a message can point at
    #: the candidate it is about.
    candidate_id: Optional[uuid.UUID] = None
    read_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=_utcnow)

    @staticmethod
    def key_for(a: str, b: str) -> str:
        return "|".join(sorted([a.strip().lower(), b.strip().lower()]))


class MessageThread(BaseModel):
    """A conversation summary for the inbox list."""

    counterpart_email: str
    counterpart_name: str
    last_message: str
    last_message_at: datetime
    unread_count: int = 0
