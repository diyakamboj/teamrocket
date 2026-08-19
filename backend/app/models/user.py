"""Recruiter accounts.

Passwords are stored as PBKDF2-HMAC-SHA256 hashes with a per-user random
salt — never in plain text, and never recoverable from the record. Sessions
are opaque random tokens stored alongside the account, so signing out or
changing a password can invalidate them server-side (a signed stateless
token could not be revoked).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    email: str
    name: str
    role: str = "Recruiter"
    department: str = "Talent Acquisition"
    password_hash: str
    password_salt: str
    #: Active session tokens. A list so signing in on a second device does
    #: not silently sign you out of the first.
    session_tokens: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utcnow)
    last_login_at: Optional[datetime] = None


class PublicUser(BaseModel):
    """What the API returns about an account — never the hash or the salt."""

    id: uuid.UUID
    email: str
    name: str
    role: str
    department: str

    @classmethod
    def of(cls, user: User) -> "PublicUser":
        return cls(
            id=user.id,
            email=user.email,
            name=user.name,
            role=user.role,
            department=user.department,
        )
