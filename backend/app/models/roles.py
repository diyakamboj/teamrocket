"""The three roles the product recognises, and what each may do.

Roles used to be a free-text string defaulting to "Recruiter", so an account
could hold any label at all and nothing was ever checked against it. These
are the only valid values, and `normalise_role` is what turns anything
arriving from outside -- a registration form, an Entra ID token -- into one
of them.

Deliberately three. HR is not among them: hiring decisions here are made by
recruiters and hiring managers, and platform administration by IT, so an HR
role would carry no permission the other three do not already hold.
"""

from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    RECRUITER = "recruiter"
    HIRING_MANAGER = "hiring_manager"
    IT_ADMIN = "it_admin"


#: What each role is called in the interface.
ROLE_LABELS: dict[Role, str] = {
    Role.RECRUITER: "Recruiter",
    Role.HIRING_MANAGER: "Hiring Manager",
    Role.IT_ADMIN: "IT Admin",
}

ROLE_DESCRIPTIONS: dict[Role, str] = {
    Role.RECRUITER: "Sources and screens candidates, runs the pipeline.",
    Role.HIRING_MANAGER: "Reviews shortlists and interviews for their own roles.",
    Role.IT_ADMIN: "Manages accounts, integrations and platform settings.",
}

DEFAULT_ROLE = Role.RECRUITER

#: Spellings we accept from outside and what they map to. Entra ID app roles
#: and group names vary by tenant, and older accounts in the store carry
#: free-text labels, so both have to land somewhere valid.
_ALIASES: dict[str, Role] = {
    "recruiter": Role.RECRUITER,
    "technical recruiter": Role.RECRUITER,
    "talent acquisition": Role.RECRUITER,
    "sourcer": Role.RECRUITER,
    "hiring manager": Role.HIRING_MANAGER,
    "hiringmanager": Role.HIRING_MANAGER,
    "manager": Role.HIRING_MANAGER,
    "interviewer": Role.HIRING_MANAGER,
    "it admin": Role.IT_ADMIN,
    "itadmin": Role.IT_ADMIN,
    "admin": Role.IT_ADMIN,
    "administrator": Role.IT_ADMIN,
    "it": Role.IT_ADMIN,
}


def normalise_role(value: object) -> Role:
    """Best valid role for `value`, falling back to recruiter.

    Never raises: an unrecognised label from an identity provider must not
    be able to lock someone out of the product, and the fallback is the
    least-privileged of the three.
    """
    if isinstance(value, Role):
        return value
    text = str(value or "").strip().lower()
    if not text:
        return DEFAULT_ROLE
    key = text.replace("_", " ").replace("-", " ")
    key = " ".join(key.split())
    if key in _ALIASES:
        return _ALIASES[key]
    compact = key.replace(" ", "_")
    for role in Role:
        if compact == role.value:
            return role
    return DEFAULT_ROLE


def label_for(value: object) -> str:
    return ROLE_LABELS[normalise_role(value)]
