"""Sharing and messaging between connected recruiters.

Both are gated on an accepted connection: you can only share a candidate with,
or message, someone who has agreed to connect. A share never moves ownership
of the candidate and is always revocable.

A share carries a permission. "view" is the original read-only share. With
"collaborate" the recipient can also add notes and move the candidate through
the owner's pipeline — enough for two recruiters to work one candidate
together, while the record, and the right to revoke, stay with the owner.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


#: What a recipient may do with a shared candidate.
SHARE_PERMISSIONS = ("view", "collaborate")


class CandidateShare(BaseModel):
    """One candidate, shared by its owner with one connected recruiter."""

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    candidate_id: uuid.UUID
    owner_email: str
    shared_with_email: str
    #: "view" (read-only) or "collaborate" (may add notes and move the
    #: candidate in the owner's pipeline). Defaults to read-only so shares
    #: written before permissions existed keep their original meaning.
    permission: str = "view"
    #: Why it was shared — shown alongside the candidate for the recipient.
    note: Optional[str] = None
    #: Job the sharing recruiter was working the candidate for, if any.
    job_id: Optional[uuid.UUID] = None
    job_title: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)

    def allows_collaboration(self) -> bool:
        return self.permission == "collaborate"


class CandidateNote(BaseModel):
    """A note on a candidate, visible to the owner and everyone the candidate
    is shared with. This is the shared workspace two recruiters use to work
    one candidate — distinct from a direct message, which is between people
    rather than about a candidate.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    candidate_id: uuid.UUID
    author_email: str
    author_name: Optional[str] = None
    body: str
    #: Job this note was written in the context of, when there is one.
    job_id: Optional[uuid.UUID] = None
    created_at: datetime = Field(default_factory=_utcnow)


class SharedRound(BaseModel):
    """One round of the owner's loop, named so a collaborator can move the
    candidate into it without access to the job itself."""

    id: str
    name: str
    sequence: int


class SharedCandidateView(BaseModel):
    """A shared candidate as the recipient sees it: enough to judge fit,
    without inheriting the record.

    When the share names a job, it also carries where the candidate stands in
    that job's pipeline and the rounds available. A collaborator cannot list
    the owner's jobs, so without this there is nowhere for them to act.
    """

    share_id: uuid.UUID
    candidate_id: uuid.UUID
    name: str
    title: Optional[str] = None
    location: Optional[str] = None
    skills: list[str] = Field(default_factory=list)
    shared_by_email: str
    shared_by_name: str
    #: The recipient. Needed by the owner's "shared by you" list, where
    #: "shared by" is themselves and tells them nothing.
    shared_with_email: str = ""
    shared_with_name: str = ""
    permission: str = "view"
    note: Optional[str] = None
    job_id: Optional[uuid.UUID] = None
    job_title: Optional[str] = None
    #: Where the candidate stands in that job's pipeline, and the rounds they
    #: can be moved between. Empty when the share names no job.
    stage: Optional[str] = None
    round_id: Optional[str] = None
    round_name: Optional[str] = None
    rounds: list[SharedRound] = Field(default_factory=list)
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
