"""Request-scoped dependencies: who is calling, and what they may do."""

from typing import Annotated, Callable, Optional

from fastapi import Depends, Header

from app.config import settings
from app.models.roles import Role, normalise_role
from app.models.user import User
from app.storage.store import Store, get_store
from app.utils.error_handlers import ForbiddenError, UnauthorizedError

AppStore = Annotated[Store, Depends(get_store)]


def _bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def get_current_user(
    store: AppStore,
    authorization: Optional[str] = Header(default=None),
    x_recruiter_email: Optional[str] = Header(default=None),
) -> Optional[User]:
    """The account behind this request.

    The session token is the only thing that proves identity. Before this,
    every data endpoint trusted an `X-Recruiter-Email` header with a default
    value, so any caller could read any recruiter's candidates by changing a
    string -- and with no header at all they were served as
    `recruiter@example.com`. Nothing was authenticated.

    The header survives as a *fallback* for local development and the test
    suite, gated behind ALLOW_HEADER_IDENTITY, and even then it only resolves
    to an account that actually exists.
    """
    from app.services import auth_service

    token = _bearer(authorization)
    if token:
        user = auth_service.find_by_token(store, token)
        if user is None:
            # A token was offered and it is not valid. Falling back to the
            # header here would make an expired session silently become
            # whoever the header claims.
            raise UnauthorizedError()
        return user

    if settings.ALLOW_HEADER_IDENTITY:
        email = (x_recruiter_email or settings.DEFAULT_RECRUITER_EMAIL).strip().lower()
        existing = auth_service.find_by_email(store, email)
        if existing is not None:
            return existing
        # Header mode names a recruiter who may not have an account -- local
        # scripts and the test suite work this way. Stand in a recruiter so
        # role checks resolve rather than 401, which would make the gates
        # untestable without registering an account for every case. Off in a
        # deployment, where the token is the only identity.
        return User(
            email=email,
            name=email.split("@")[0],
            role=Role.RECRUITER,
            password_hash="",
            password_salt="",
        )

    return None


CurrentUser = Annotated[Optional[User], Depends(get_current_user)]


def get_recruiter_email(
    user: CurrentUser,
    x_recruiter_email: Optional[str] = Header(default=None),
) -> str:
    """The email everything is scoped and audited by.

    Taken from the authenticated account when there is one. The header is
    only consulted in header-identity mode, which is off in any deployment.
    """
    if user is not None:
        return user.email
    if settings.ALLOW_HEADER_IDENTITY:
        # Development and tests: the header names the recruiter, and an
        # absent header keeps the historical default so local scripts and
        # the suite keep working. This whole branch is off in a deployment.
        return (x_recruiter_email or settings.DEFAULT_RECRUITER_EMAIL).strip().lower()
    raise UnauthorizedError()


RecruiterEmail = Annotated[str, Depends(get_recruiter_email)]


def require_role(*allowed: Role) -> Callable[..., User]:
    """Restrict an endpoint to particular roles.

    Roles were stored on every account and checked precisely nowhere, so a
    hiring manager and an IT admin had exactly the recruiter's powers. This
    is what makes the role mean something.
    """

    def dependency(user: CurrentUser) -> User:
        if user is None:
            raise UnauthorizedError()
        if normalise_role(user.role) not in allowed:
            raise ForbiddenError(
                "Your role does not allow that.",
                {
                    "your_role": normalise_role(user.role).value,
                    "allowed": [role.value for role in allowed],
                },
            )
        return user

    return dependency


#: Who may run a hiring pipeline: source candidates, upload résumés, create
#: roles. A hiring manager reviews their own roles but does not source for
#: them; IT administers the platform rather than hiring through it.
CanRunPipeline = Annotated[User, Depends(require_role(Role.RECRUITER, Role.IT_ADMIN))]

#: Who may decide on a candidate. Hiring managers are included: deciding on
#: the people in front of them is the whole reason they are in the product.
CanDecide = Annotated[
    User, Depends(require_role(Role.RECRUITER, Role.HIRING_MANAGER, Role.IT_ADMIN))
]

#: Platform administration.
IsAdmin = Annotated[User, Depends(require_role(Role.IT_ADMIN))]
