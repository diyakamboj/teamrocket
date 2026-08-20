"""The role model: exactly three, and nothing else gets in."""

import pytest

from app.models.roles import DEFAULT_ROLE, Role, label_for, normalise_role
from app.models.user import User


def test_there_are_exactly_three_roles():
    assert {r.value for r in Role} == {"recruiter", "hiring_manager", "it_admin"}


def test_hr_is_not_a_role_and_resolves_to_the_least_privileged_one():
    """HR was removed deliberately; an account carrying it must still load."""
    assert "hr" not in {r.value for r in Role}
    assert normalise_role("HR") is Role.RECRUITER
    assert normalise_role("Human Resources") is Role.RECRUITER


@pytest.mark.parametrize(
    "given,expected",
    [
        ("recruiter", Role.RECRUITER),
        ("Technical Recruiter", Role.RECRUITER),
        ("hiring manager", Role.HIRING_MANAGER),
        ("Hiring Manager", Role.HIRING_MANAGER),
        ("hiring_manager", Role.HIRING_MANAGER),
        ("IT Admin", Role.IT_ADMIN),
        ("admin", Role.IT_ADMIN),
        ("it_admin", Role.IT_ADMIN),
    ],
)
def test_labels_from_forms_and_identity_providers_are_accepted(given, expected):
    assert normalise_role(given) is expected


@pytest.mark.parametrize("given", ["", None, "   ", "Wizard", 42])
def test_anything_unrecognised_falls_back_rather_than_raising(given):
    """An unexpected label from an identity provider must not lock a user out."""
    assert normalise_role(given) is DEFAULT_ROLE


def test_stored_accounts_with_legacy_labels_still_load():
    user = User(
        email="a@b.c",
        name="A",
        role="HR Business Partner",
        password_hash="x",
        password_salt="y",
    )
    assert user.role is Role.RECRUITER


def test_labels_are_human_readable():
    assert label_for("hiring_manager") == "Hiring Manager"
    assert label_for("it_admin") == "IT Admin"


def test_roles_endpoint_matches_what_the_api_accepts(client):
    response = client.get("/api/auth/roles")
    assert response.status_code == 200
    assert {r["value"] for r in response.json()} == {r.value for r in Role}
