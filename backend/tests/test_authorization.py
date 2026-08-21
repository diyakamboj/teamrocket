"""Who is calling, and what they are allowed to do.

Two problems this covers. Identity was self-asserted: every data endpoint
trusted an `X-Recruiter-Email` header with a default value, so any caller
could read any recruiter's candidates by changing a string, and with no
header at all was served as `recruiter@example.com`. And roles were stored
on every account but checked nowhere, so a hiring manager and an IT admin
had precisely the recruiter's powers.
"""

import pytest

from app.config import settings
from app.models.roles import Role

ACCOUNT = {
    "email": "owner@example.com",
    "password": "correct horse battery",
    "name": "Owner",
    "department": "Talent",
}


def _register(client, **overrides):
    payload = {**ACCOUNT, **overrides}
    return client.post("/api/auth/register", json=payload).json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- identity ----------


def test_a_session_token_identifies_the_caller(client):
    session = _register(client)
    response = client.get("/api/candidates", headers=_auth(session["token"]))
    assert response.status_code == 200


def test_the_token_wins_over_a_conflicting_email_header(client):
    """The header cannot be used to act as somebody else.

    This is the impersonation the old code allowed: send any email you like
    and the API served that recruiter's data.
    """
    session = _register(client, email="real@example.com")
    response = client.get(
        "/api/candidates",
        headers={**_auth(session["token"]), "X-Recruiter-Email": "victim@example.com"},
    )
    assert response.status_code == 200
    # Scoped to the token's owner, not the header's claim.
    assert response.json() == []


def test_an_invalid_token_is_rejected_rather_than_falling_back_to_the_header(client):
    """An expired session must not silently become whoever the header names."""
    response = client.get(
        "/api/candidates",
        headers={"Authorization": "Bearer not-a-real-token",
                 "X-Recruiter-Email": "someone@example.com"},
    )
    assert response.status_code == 401


def test_header_identity_is_refused_when_the_mode_is_off(client, monkeypatch):
    """What a deployment looks like: the token is the only identity."""
    monkeypatch.setattr(settings, "ALLOW_HEADER_IDENTITY", False)
    response = client.get("/api/candidates", headers={"X-Recruiter-Email": "anyone@example.com"})
    assert response.status_code == 401


def test_no_credentials_at_all_are_refused_when_the_mode_is_off(client, monkeypatch):
    monkeypatch.setattr(settings, "ALLOW_HEADER_IDENTITY", False)
    assert client.get("/api/candidates").status_code == 401


# ---------- roles ----------


@pytest.mark.parametrize(
    "role,expected",
    [
        (Role.RECRUITER.value, 200),
        (Role.IT_ADMIN.value, 200),
        # A hiring manager reviews their own roles; they do not open new ones.
        (Role.HIRING_MANAGER.value, 403),
    ],
)
def test_only_sourcing_roles_can_create_a_job(client, role, expected):
    session = _register(client, email=f"{role}@example.com", role=role)
    response = client.post(
        "/api/jobs",
        json={"title": "Backend Engineer", "description": "d", "required_skills": ["Python"]},
        headers=_auth(session["token"]),
    )
    assert response.status_code == expected


def test_a_refusal_says_which_role_you_have_and_which_are_allowed(client):
    session = _register(client, email="hm@example.com", role=Role.HIRING_MANAGER.value)
    response = client.post(
        "/api/jobs",
        json={"title": "Backend Engineer", "description": "d"},
        headers=_auth(session["token"]),
    )
    assert response.status_code == 403
    details = response.json()["details"]
    assert details["your_role"] == "hiring_manager"
    assert set(details["allowed"]) == {"recruiter", "it_admin"}


def test_a_hiring_manager_can_still_decide_on_a_candidate(client):
    """The gate restricts sourcing, not the thing they are here to do."""
    from app.models.roles import normalise_role

    session = _register(client, email="hm2@example.com", role=Role.HIRING_MANAGER.value)
    assert normalise_role(session["user"]["role"]) is Role.HIRING_MANAGER

    response = client.post(
        "/api/candidates/decision",
        json={
            "candidate_id": "00000000-0000-0000-0000-000000000000",
            "name": "Ada Vance",
            "email": "ada@example.com",
            "job_title": "Backend Engineer",
            "decision": "advanced",
        },
        headers=_auth(session["token"]),
    )
    assert response.status_code != 403
