"""Password hashing and session tokens for recruiter accounts.

PBKDF2-HMAC-SHA256 from the standard library rather than a new dependency:
with a per-user salt and a high iteration count it is a sound choice for
password storage, and it keeps the deployment free of native build steps.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
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


class GoogleTokenError(Exception):
    """The credential from Google Identity Services did not check out."""


def verify_google_credential(credential: str, client_id: str) -> dict:
    """Verify a Google Identity Services ID token and return its claims.

    Verification (not a trust-the-client decode) matters here: the token is
    signed by Google, and checking that signature plus the audience is what
    stops anyone from posting a hand-crafted `{"email": "victim@x.com"}` at
    this endpoint and being logged in as them.
    """
    # Imported lazily so a deployment without `google-auth` installed only
    # fails when someone actually uses Google sign-in, not on every startup.
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    try:
        claims = google_id_token.verify_oauth2_token(
            credential, google_requests.Request(), audience=client_id
        )
    except Exception as exc:
        raise GoogleTokenError(str(exc)) from exc

    if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise GoogleTokenError("Unexpected token issuer")
    if not claims.get("email_verified"):
        raise GoogleTokenError("Google account email is not verified")
    return claims


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


#: How long a reset link stays valid. Long enough to find the email, short
#: enough that an old message in an inbox is not a standing key.
RESET_TOKEN_TTL = timedelta(minutes=30)


def new_reset_token() -> str:
    return secrets.token_urlsafe(32)


def issue_reset_token(store: Store, user: User) -> str:
    """Start a reset. Returns the raw token — only the hash is stored.

    Issuing a new one invalidates any previous link, so a reset requested
    twice cannot leave two working keys in an inbox.
    """
    token = new_reset_token()
    token_hash, salt = hash_password(token)
    user.reset_token_hash = token_hash
    user.reset_token_salt = salt
    user.reset_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + RESET_TOKEN_TTL
    store.users.save(user)
    return token


def find_by_reset_token(store: Store, token: str) -> Optional[User]:
    """The account this reset token belongs to, if it is still valid.

    Scans rather than indexes: the token is stored hashed with a per-user
    salt, so there is nothing to look it up by. The user table is small and
    this runs once per reset.
    """
    if not token:
        return None
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for user in store.users.list_all():
        if not (user.reset_token_hash and user.reset_token_salt):
            continue
        if user.reset_expires_at is None or user.reset_expires_at < now:
            continue
        if verify_password(token, user.reset_token_hash, user.reset_token_salt):
            return user
    return None


def clear_reset_token(user: User) -> None:
    user.reset_token_hash = None
    user.reset_token_salt = None
    user.reset_expires_at = None


#: Collections whose rows belong to one recruiter, and the field that says so.
OWNED_BY = (
    ("candidates", "owner_email"),
    ("jobs", "created_by"),
    ("resume_uploads", "recruiter_email"),
    ("company_documents", "recruiter_email"),
    ("agent_sessions", "recruiter_email"),
    ("audit_logs", "recruiter_email"),
    ("candidate_notes", "recruiter_email"),
)


def purge_account_data(store: Store, user: User) -> int:
    """Everything this account owns. Returns how many rows were removed.

    Deleting the account alone would leave candidates and uploads reachable
    by nobody -- records that still hold real people's résumés and contact
    details, with no one able to act on a deletion request about them.
    """
    email = (user.email or "").lower()
    removed = 0

    for name, field in OWNED_BY:
        repo = getattr(store, name, None)
        if repo is None:
            continue
        try:
            rows = repo.query(lambda r, f=field: str(getattr(r, f, "") or "").lower() == email)
        except Exception:
            continue
        for row in rows:
            try:
                repo.delete(row.id)
                removed += 1
            except Exception:
                # Append-only collections are not addressed by id. Their rows
                # carry no standalone value once the account is gone.
                pass

    return removed
