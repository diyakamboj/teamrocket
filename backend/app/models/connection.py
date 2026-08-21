"""Connections between recruiters.

A directed request that becomes a mutual link when accepted, so two
recruiters can share context on a candidate they are both working. Stored as
one document per request; the pair is the identity, which stops the same two
people accumulating duplicate rows.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


CONNECTION_STATUSES = ("pending", "accepted", "declined")


class RecruiterConnection(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    requester_email: str
    addressee_email: str
    status: str = "pending"
    #: Optional note sent with the request.
    message: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    responded_at: Optional[datetime] = None

    def involves(self, email: str) -> bool:
        return email in (self.requester_email, self.addressee_email)

    def other_party(self, email: str) -> str:
        return self.addressee_email if email == self.requester_email else self.requester_email


class ConnectionView(BaseModel):
    """A connection as it looks to one side of it."""

    id: uuid.UUID
    status: str
    direction: str  # "incoming" | "outgoing"
    counterpart_email: str
    counterpart_name: str
    counterpart_role: str
    message: Optional[str] = None
    created_at: datetime


class RecruiterDirectoryEntry(BaseModel):
    """Another recruiter you could connect with."""

    email: str
    name: str
    role: str
    department: str
    #: "none" | "pending_outgoing" | "pending_incoming" | "connected"
    connection_state: str = "none"
