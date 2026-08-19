"""Password hashing and session tokens for recruiter accounts.

PBKDF2-HMAC-SHA256 from the standard library rather than a new dependency:
with a per-user salt and a high iteration count it is a sound choice for
password storage, and it keeps the deployment free of native build steps.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Optional

from app.models.user import User
from app.storage.store import Store
from app.utils.validators import is_valid_email, normalize_email

#: OWASP's floor for PBKDF2-HMAC-SHA256 is well below this; raising it costs
#: the login request a few milliseconds and an attacker far more.
PBKDF2_ITERATIONS = 240_000
MIN_PASSWORD_LENGTH = 8


def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    """Returns (hash, salt), both hex — a fresh random salt unless given one."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return digest.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    candidate, _ = hash_password(password, salt)
    # Constant-time: a timing difference here leaks how much of the hash matched.
    return hmac.compare_digest(candidate, password_hash)


def password_problem(password: str) -> Optional[str]:
    """Human-readable reason a password is unacceptable, or None."""
    if len(password or "") < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    if password.strip() != password:
        return "Password must not start or end with a space."
    return None


def email_problem(email: str) -> Optional[str]:
    if not is_valid_email(email or ""):
        return "Enter a valid email address."
    return None


def find_by_email(store: Store, email: str) -> Optional[User]:
    target = normalize_email(email)
    return next(
        (u for u in store.users.list_all() if normalize_email(u.email) == target), None
    )


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def find_by_token(store: Store, token: str) -> Optional[User]:
    if not token:
        return None
    return next((u for u in store.users.list_all() if token in u.session_tokens), None)
