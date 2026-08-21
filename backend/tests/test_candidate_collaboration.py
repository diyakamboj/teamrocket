"""Working one candidate with another recruiter.

A share carries a permission: "view" is the original read-only share, and
"collaborate" additionally lets the recipient add notes and move the
candidate. These tests pin the boundary between the two.
"""

import uuid

import pytest

from app.models.candidate import Candidate
from app.models.connection import RecruiterConnection
from app.models.user import User

OWNER = "recruiter@example.com"
PEER = "peer@example.com"
STRANGER = "stranger@example.com"


@pytest.fixture()
def people(store):
    for email, name in ((OWNER, "Owner One"), (PEER, "Peer Two"), (STRANGER, "Stranger Three")):
        store.users.save(
            User(
                email=email,
                name=name,
                role="Recruiter",
                password_hash="x",
                password_salt="y",
            )
        )
    store.recruiter_connections.save(
        RecruiterConnection(requester_email=OWNER, addressee_email=PEER, status="accepted")
    )


@pytest.fixture()
def owned_candidate(store):
    candidate = Candidate(
        id=uuid.uuid4(),
        owner_email=OWNER,
        name="Alice Johnson",
        email="alice.johnson@example.com",
        resume_text="Python, SQL.",
        skills=["Python"],
    )
    store.candidates.save(candidate)
    return candidate


def _share(client, candidate, permission):
    return client.post(
        "/api/connections/share",
        json={
            "candidate_id": str(candidate.id),
            "email": PEER,
            "permission": permission,
        },
        headers={"X-Recruiter-Email": OWNER},
    )


def test_share_defaults_to_view_only(client, people, owned_candidate):
    response = client.post(
        "/api/connections/share",
        json={"candidate_id": str(owned_candidate.id), "email": PEER},
        headers={"X-Recruiter-Email": OWNER},
    )

    assert response.status_code == 201
    # The wider grant must be chosen, never inherited by omission.
    assert response.json()["permission"] == "view"


def test_share_can_grant_collaboration(client, people, owned_candidate):
    response = _share(client, owned_candidate, "collaborate")

    assert response.status_code == 201
    assert response.json()["permission"] == "collaborate"
    assert response.json()["shared_with_email"] == PEER


def test_an_unknown_permission_is_rejected(client, people, owned_candidate):
    response = _share(client, owned_candidate, "owner")

    assert response.status_code == 422


def test_collaborator_can_add_a_note(client, people, owned_candidate):
    _share(client, owned_candidate, "collaborate")

    response = client.post(
        f"/api/connections/candidates/{owned_candidate.id}/notes",
        json={"body": "Strong on system design, weak on SQL."},
        headers={"X-Recruiter-Email": PEER},
    )

    assert response.status_code == 201
    assert response.json()["author_name"] == "Peer Two"

    # And the owner sees it on the same thread.
    owner_view = client.get(
        f"/api/connections/candidates/{owned_candidate.id}/notes",
        headers={"X-Recruiter-Email": OWNER},
    )
    assert [n["body"] for n in owner_view.json()] == ["Strong on system design, weak on SQL."]
    assert owner_view.json()[0]["mine"] is False


def test_view_only_share_can_read_notes_but_not_write(client, people, owned_candidate):
    _share(client, owned_candidate, "view")
    client.post(
        f"/api/connections/candidates/{owned_candidate.id}/notes",
        json={"body": "Owner's own note."},
        headers={"X-Recruiter-Email": OWNER},
    )

    read = client.get(
        f"/api/connections/candidates/{owned_candidate.id}/notes",
        headers={"X-Recruiter-Email": PEER},
    )
    assert read.status_code == 200
    assert len(read.json()) == 1

    write = client.post(
        f"/api/connections/candidates/{owned_candidate.id}/notes",
        json={"body": "Should not land."},
        headers={"X-Recruiter-Email": PEER},
    )
    assert write.status_code == 422


def test_a_stranger_cannot_see_the_note_thread(client, people, owned_candidate):
    _share(client, owned_candidate, "collaborate")

    response = client.get(
        f"/api/connections/candidates/{owned_candidate.id}/notes",
        headers={"X-Recruiter-Email": STRANGER},
    )

    # 404 rather than 403: a stranger should not learn the candidate exists.
    assert response.status_code == 404


def test_owner_can_promote_and_demote_a_share(client, people, owned_candidate):
    share_id = _share(client, owned_candidate, "view").json()["share_id"]

    promoted = client.patch(
        f"/api/connections/share/{share_id}",
        json={"permission": "collaborate"},
        headers={"X-Recruiter-Email": OWNER},
    )
    assert promoted.status_code == 200
    assert promoted.json()["permission"] == "collaborate"

    demoted = client.patch(
        f"/api/connections/share/{share_id}",
        json={"permission": "view"},
        headers={"X-Recruiter-Email": OWNER},
    )
    assert demoted.json()["permission"] == "view"

    # The demotion actually takes away write access.
    write = client.post(
        f"/api/connections/candidates/{owned_candidate.id}/notes",
        json={"body": "No longer allowed."},
        headers={"X-Recruiter-Email": PEER},
    )
    assert write.status_code == 422


def test_recipient_cannot_promote_their_own_share(client, people, owned_candidate):
    share_id = _share(client, owned_candidate, "view").json()["share_id"]

    response = client.patch(
        f"/api/connections/share/{share_id}",
        json={"permission": "collaborate"},
        headers={"X-Recruiter-Email": PEER},
    )

    assert response.status_code == 404


def test_resharing_updates_the_permission_rather_than_erroring(client, people, owned_candidate):
    _share(client, owned_candidate, "view")

    again = _share(client, owned_candidate, "collaborate")

    assert again.status_code == 201
    assert again.json()["permission"] == "collaborate"
    assert len(client.get(
        "/api/connections/shared-by-me", headers={"X-Recruiter-Email": OWNER}
    ).json()) == 1


def test_sharing_requires_a_connection(client, store, owned_candidate):
    store.users.save(User(email=OWNER, name="Owner One", password_hash="x", password_salt="y"))
    store.users.save(User(email=STRANGER, name="Stranger", password_hash="x", password_salt="y"))

    response = client.post(
        "/api/connections/share",
        json={
            "candidate_id": str(owned_candidate.id),
            "email": STRANGER,
            "permission": "collaborate",
        },
        headers={"X-Recruiter-Email": OWNER},
    )

    assert response.status_code == 422
