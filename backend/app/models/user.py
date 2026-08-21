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

from pydantic import BaseModel, Field, field_validator

from app.models.roles import DEFAULT_ROLE, Role, normalise_role


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    email: str
    name: str
    role: Role = DEFAULT_ROLE
    department: str = "Talent Acquisition"

    @field_validator("role", mode="before")
    @classmethod
    def _coerce_role(cls, value):
        """Accounts stored before roles were constrained hold free text.

        Reading one must not blow up, so anything unrecognised resolves to
        the least-privileged role rather than failing validation.
        """
        return normalise_role(value)
    password_hash: str
    password_salt: str
    #: "password" for a normal signup, "google" for one created via "Sign in
    #: with Google" — those hold a random, never-issued password hash, so
    #: delete-account's password re-check has to be skipped for them.
    auth_provider: str = "password"
    #: Active session tokens. A list so signing in on a second device does
    #: not silently sign you out of the first.
    session_tokens: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utcnow)
    last_login_at: Optional[datetime] = None

    #: Password reset. The token is stored hashed for the same reason the
    #: password is: a leaked database should not hand out working reset
    #: links. Single-use and time-limited -- consumed on success, and
    #: ignored after `reset_expires_at`.
    reset_token_hash: Optional[str] = None
    reset_token_salt: Optional[str] = None
    reset_expires_at: Optional[datetime] = None


class PublicUser(BaseModel):
    """What the API returns about an account — never the hash or the salt."""

    id: uuid.UUID
    email: str
    name: str
    role: Role
    department: str
    auth_provider: str

    @classmethod
    def of(cls, user: User) -> "PublicUser":
        return cls(
            id=user.id,
            email=user.email,
            name=user.name,
            role=user.role,
            department=user.department,
            auth_provider=user.auth_provider,
        )
