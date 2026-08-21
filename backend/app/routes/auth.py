"""Registration, sign-in, and the current account.

Sign-in returns an opaque session token the client stores and sends back as
`Authorization: Bearer <token>`. The rest of the API still identifies the
recruiter by the `X-Recruiter-Email` header — this adds real credentials and
a verifiable session in front of that, rather than rewiring every endpoint at
once. `GET /api/auth/me` is what makes a stored session trustworthy: the
client cannot simply assert who it is.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from app.dependencies import AppStore
from app.models.evaluation import AuditLog
from app.models.roles import ROLE_DESCRIPTIONS, ROLE_LABELS, Role, normalise_role
from app.models.user import PublicUser, User
from app.config import settings
from app.services import auth_service
from app.services.email_service import email_service
from app.utils.error_handlers import UnauthorizedError, ValidationAppError
from app.utils.logger import get_logger
from app.utils.validators import normalize_email

router = APIRouter()
logger = get_logger(__name__)


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str
    role: str = "recruiter"
    department: str = "Talent Acquisition"


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: PublicUser


def _audit(store, **fields) -> None:
    try:
        store.audit_logs.save(AuditLog(**fields))
    except Exception as exc:
        logger.warning("Failed to persist audit log %s: %s", fields.get("action"), exc)


def _bearer(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        return ""
    return authorization[7:].strip()


@router.post("/register", response_model=AuthResponse, status_code=201)
def register(payload: RegisterRequest, store: AppStore):
    problem = auth_service.email_problem(payload.email) or auth_service.password_problem(
        payload.password
    )
    if problem:
        raise ValidationAppError(problem)
    if not (payload.name or "").strip():
        raise ValidationAppError("Enter your name.")

    if auth_service.find_by_email(store, payload.email):
        # Registration is a public endpoint, so it does confirm an address is
        # taken — the alternative (silent success) makes the form unusable.
        raise ValidationAppError("An account with that email already exists.")

    password_hash, salt = auth_service.hash_password(payload.password)
    token = auth_service.new_session_token()
    user = User(
        email=normalize_email(payload.email),
        name=payload.name.strip(),
        # Whatever the form sent, it lands on one of the three roles.
        role=normalise_role(payload.role),
        department=payload.department.strip() or "Talent Acquisition",
        password_hash=password_hash,
        password_salt=salt,
        session_tokens=[token],
        last_login_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    store.users.save(user)

    _audit(
        store,
        recruiter_email=user.email,
        action="auth_register",
        resource_type="user",
        resource_id=user.id,
    )
    return AuthResponse(token=token, user=PublicUser.of(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, store: AppStore):
    user = auth_service.find_by_email(store, payload.email)
    # Same message whether the address is unknown or the password is wrong,
    # so this endpoint cannot be used to enumerate accounts.
    invalid = ValidationAppError("Email or password is incorrect.")
    if not user:
        # Spend comparable time regardless, so a missing account is not
        # detectable by how fast the request fails.
        auth_service.hash_password(payload.password)
        raise invalid
    if not auth_service.verify_password(payload.password, user.password_hash, user.password_salt):
        raise invalid

    token = auth_service.new_session_token()
    # Keep a bounded number of live sessions per account.
    user.session_tokens = [*user.session_tokens[-4:], token]
    user.last_login_at = datetime.now(timezone.utc).replace(tzinfo=None)
    store.users.save(user)

    _audit(
        store,
        recruiter_email=user.email,
        action="auth_login",
        resource_type="user",
        resource_id=user.id,
    )
    return AuthResponse(token=token, user=PublicUser.of(user))


class GoogleAuthRequest(BaseModel):
    #: The ID token Google Identity Services hands the frontend's callback —
    #: a signed JWT, not an OAuth access token, so the backend can verify it
    #: itself without a further round-trip to Google.
    credential: str


@router.post("/google", response_model=AuthResponse)
def google_login(payload: GoogleAuthRequest, store: AppStore):
    if not settings.GOOGLE_CLIENT_ID:
        raise ValidationAppError("Google sign-in is not configured on this server.")

    try:
        claims = auth_service.verify_google_credential(
            payload.credential, settings.GOOGLE_CLIENT_ID
        )
    except auth_service.GoogleTokenError:
        raise ValidationAppError("Could not verify that Google sign-in. Try again.")

    email = normalize_email(claims["email"])
    name = (claims.get("name") or email.split("@")[0]).strip()

    user = auth_service.find_by_email(store, email)
    if user is None:
        # A password is never issued for this account — random and
        # discarded, it exists only to satisfy the field, never to sign in
        # with. See auth_provider on the model for how the rest of the API
        # knows not to expect one.
        password_hash, salt = auth_service.hash_password(auth_service.new_session_token())
        user = User(
            email=email,
            name=name,
            password_hash=password_hash,
            password_salt=salt,
            auth_provider="google",
        )

    token = auth_service.new_session_token()
    user.session_tokens = [*user.session_tokens[-4:], token]
    user.last_login_at = datetime.now(timezone.utc).replace(tzinfo=None)
    store.users.save(user)

    _audit(
        store,
        recruiter_email=user.email,
        action="auth_google_login",
        resource_type="user",
        resource_id=user.id,
    )
    return AuthResponse(token=token, user=PublicUser.of(user))


@router.get("/me", response_model=PublicUser)
def me(store: AppStore, authorization: Optional[str] = Header(None)):
    user = auth_service.find_by_token(store, _bearer(authorization))
    if not user:
        raise UnauthorizedError()
    return PublicUser.of(user)


class ProfileUpdate(BaseModel):
    """What a recruiter may change about their own account.

    Not the email: it is the login and the key every candidate, job and
    document is scoped by, so changing it here would orphan their data.
    Not the role either — that is an administrative decision, not a
    self-service one.
    """

    name: Optional[str] = None
    department: Optional[str] = None


@router.patch("/me", response_model=PublicUser)
def update_me(
    payload: ProfileUpdate,
    store: AppStore,
    authorization: Optional[str] = Header(None),
):
    """Update the signed-in account.

    Recruiter identity used to live in browser localStorage, merged *over*
    the session, so a value saved once won permanently — including after
    signing in as somebody else, which is how one account ended up showing
    another's name. Identity is account data and belongs on the account.
    """
    user = auth_service.find_by_token(store, _bearer(authorization))
    if not user:
        raise UnauthorizedError()

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise ValidationAppError("Name cannot be empty")
        user.name = name
    if payload.department is not None:
        user.department = payload.department.strip()

    store.users.save(user)
    return PublicUser.of(user)


@router.post("/logout", status_code=204)
def logout(store: AppStore, authorization: Optional[str] = Header(None)):
    token = _bearer(authorization)
    user = auth_service.find_by_token(store, token)
    if user:
        user.session_tokens = [t for t in user.session_tokens if t != token]
        store.users.save(user)
    return None


@router.get("/roles")
def list_roles():
    """The roles an account may hold, for the registration and admin UIs.

    Served from the backend so the picker cannot drift from what the API
    will actually accept.
    """
    return [
        {"value": role.value, "label": ROLE_LABELS[role], "description": ROLE_DESCRIPTIONS[role]}
        for role in Role
    ]


class ForgotPasswordRequest(BaseModel):
    email: str


@router.post("/forgot-password", status_code=202)
def forgot_password(payload: ForgotPasswordRequest, store: AppStore):
    """Start a password reset.

    Always answers the same way, whether or not the address is registered.
    Saying "no such account" would turn this into a way to discover who has
    one, and the recruiter directory makes that worth something.
    """
    email = (payload.email or "").strip().lower()
    user = auth_service.find_by_email(store, email) if email else None

    if user is not None:
        token = auth_service.issue_reset_token(store, user)
        reset_url = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token={token}"
        result = email_service.send_password_reset(
            to_email=user.email,
            to_name=user.name,
            reset_url=reset_url,
            minutes_valid=int(auth_service.RESET_TOKEN_TTL.total_seconds() // 60),
        )
        if not result.sent:
            # The caller still gets the same answer; the operator needs to
            # know the mail never left.
            logger.warning("Password reset email not sent to %s: %s", user.email, result.error)

    return {
        "message": "If that address has an account, a reset link is on its way.",
    }


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password", response_model=AuthResponse)
def reset_password(payload: ResetPasswordRequest, store: AppStore):
    """Finish a reset and sign the account in.

    Every existing session is dropped. Someone resetting a password may be
    doing it precisely because another party has access, and leaving their
    sessions alive would defeat the point.
    """
    user = auth_service.find_by_reset_token(store, payload.token)
    if user is None:
        raise ValidationAppError(
            "That reset link is invalid or has expired. Request a new one."
        )

    problem = auth_service.password_problem(payload.new_password)
    if problem:
        raise ValidationAppError(problem)

    user.password_hash, user.password_salt = auth_service.hash_password(payload.new_password)
    auth_service.clear_reset_token(user)

    token = auth_service.new_session_token()
    user.session_tokens = [token]
    user.last_login_at = datetime.now(timezone.utc).replace(tzinfo=None)
    store.users.save(user)

    return AuthResponse(token=token, user=PublicUser.of(user))


class DeleteAccountRequest(BaseModel):
    #: Re-authentication. Deleting everything you own should not be possible
    #: from a session someone left open.
    password: str


@router.post("/delete-account", status_code=204)
def delete_account(
    payload: DeleteAccountRequest,
    store: AppStore,
    authorization: Optional[str] = Header(None),
):
    """Delete the signed-in account and everything it owns.

    Candidates, jobs, uploads and the rest go with it. Leaving them behind
    would orphan records that no one can reach but that still hold real
    people's résumés and contact details.
    """
    user = auth_service.find_by_token(store, _bearer(authorization))
    if not user:
        raise UnauthorizedError()

    # A Google account never had a password issued to it — the bearer token
    # already proves who is asking, so there is nothing to re-check.
    if user.auth_provider != "google" and not auth_service.verify_password(
        payload.password, user.password_hash, user.password_salt
    ):
        raise ValidationAppError("That password is not correct.")

    removed = auth_service.purge_account_data(store, user)
    logger.info("Deleted account %s and %d owned record(s)", user.email, removed)
    store.users.delete(user.id)
    return None
