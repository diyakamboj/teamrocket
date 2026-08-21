"""Sharing candidates and messaging between connected recruiters.

The gate is the connection: everything here must refuse a recruiter you have
not connected with, and a share must never let the recipient act as the owner.
"""

import uuid

import pytest

from app.models.candidate import Candidate
from app.models.user import User

ALICE = {"X-Recruiter-Email": "alice@example.com"}
BOB = {"X-Recruiter-Email": "bob@example.com"}
CAROL = {"X-Recruiter-Email": "carol@example.com"}


@pytest.fixture()
def network(client, store):
    for email, name in [
        ("alice@example.com", "Alice Ng"),
        ("bob@example.com", "Bob Silva"),
        ("carol@example.com", "Carol Diaz"),
    ]:
        store.users.save(User(email=email, name=name, password_hash="x", password_salt="y"))

    candidate = Candidate(
        owner_email="alice@example.com",
        name="Ada Vance",
        email="ada@example.com",
        title="Platform Engineer",
        skills=["Python", "Kubernetes"],
    )
    store.candidates.save(candidate)

    # Alice and Bob connect; Carol stays a stranger.
    request_id = client.post(
        "/api/connections", json={"email": "bob@example.com"}, headers=ALICE
    ).json()["id"]
    client.post(f"/api/connections/{request_id}/respond", json={"accept": True}, headers=BOB)
    return candidate


# ---------- sharing ----------


def test_owner_can_share_a_candidate_with_a_connection(client, network):
    response = client.post(
        "/api/connections/share",
        json={"candidate_id": str(network.id), "email": "bob@example.com", "note": "Strong on K8s"},
        headers=ALICE,
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Ada Vance"
    assert response.json()["note"] == "Strong on K8s"


def test_recipient_sees_the_shared_candidate(client, network):
    client.post(
        "/api/connections/share",
        json={"candidate_id": str(network.id), "email": "bob@example.com"},
        headers=ALICE,
    )
    shared = client.get("/api/connections/shared-with-me", headers=BOB).json()

    assert [s["name"] for s in shared] == ["Ada Vance"]
    assert shared[0]["shared_by_name"] == "Alice Ng"


def test_sharing_does_not_transfer_ownership(client, network):
    """A share is read-only: the candidate stays out of the recipient's pool."""
    client.post(
        "/api/connections/share",
        json={"candidate_id": str(network.id), "email": "bob@example.com"},
        headers=ALICE,
    )
    assert client.get("/api/candidates", headers=BOB).json() == []


def test_cannot_share_with_someone_you_are_not_connected_to(client, network):
    response = client.post(
        "/api/connections/share",
        json={"candidate_id": str(network.id), "email": "carol@example.com"},
        headers=ALICE,
    )
    assert response.status_code == 422
    assert client.get("/api/connections/shared-with-me", headers=CAROL).json() == []


def test_cannot_share_a_candidate_you_do_not_own(client, network):
    """Otherwise sharing would be a way around ownership scoping."""
    response = client.post(
        "/api/connections/share",
        json={"candidate_id": str(network.id), "email": "alice@example.com"},
        headers=BOB,
    )
    assert response.status_code == 404


def test_sharing_twice_is_rejected(client, network):
    body = {"candidate_id": str(network.id), "email": "bob@example.com"}
    client.post("/api/connections/share", json=body, headers=ALICE)
    assert client.post("/api/connections/share", json=body, headers=ALICE).status_code == 422


def test_owner_can_revoke_a_share(client, network):
    share_id = client.post(
        "/api/connections/share",
        json={"candidate_id": str(network.id), "email": "bob@example.com"},
        headers=ALICE,
    ).json()["share_id"]

    assert client.delete(f"/api/connections/share/{share_id}", headers=ALICE).status_code == 204
    assert client.get("/api/connections/shared-with-me", headers=BOB).json() == []


def test_recipient_cannot_revoke_someone_elses_share(client, network):
    share_id = client.post(
        "/api/connections/share",
        json={"candidate_id": str(network.id), "email": "bob@example.com"},
        headers=ALICE,
    ).json()["share_id"]

    assert client.delete(f"/api/connections/share/{share_id}", headers=BOB).status_code == 404


def test_share_carries_screening_evidence_when_it_exists(client, store, network):
    from app.models.screening import ScreeningSession

    store.screening_sessions.save(
        ScreeningSession(
            candidate_id=network.id,
            candidate_name=network.name,
            status="completed",
            overall_score=82.0,
            summary_pack="Strong Kubernetes ownership.",
        )
    )
    shared = client.post(
        "/api/connections/share",
        json={"candidate_id": str(network.id), "email": "bob@example.com"},
        headers=ALICE,
    ).json()

    assert shared["screening_score"] == 82.0
    assert "Kubernetes" in shared["screening_summary"]


# ---------- messaging ----------


def test_connected_recruiters_can_message(client, network):
    sent = client.post(
        "/api/connections/messages",
        json={"email": "bob@example.com", "body": "Worth a look at Ada?"},
        headers=ALICE,
    )
    assert sent.status_code == 201

    thread = client.get("/api/connections/messages/alice@example.com", headers=BOB).json()
    assert [m["body"] for m in thread] == ["Worth a look at Ada?"]


def test_both_sides_read_the_same_thread(client, network):
    client.post(
        "/api/connections/messages",
        json={"email": "bob@example.com", "body": "First"},
        headers=ALICE,
    )
    client.post(
        "/api/connections/messages",
        json={"email": "alice@example.com", "body": "Second"},
        headers=BOB,
    )

    alice_view = client.get("/api/connections/messages/bob@example.com", headers=ALICE).json()
    bob_view = client.get("/api/connections/messages/alice@example.com", headers=BOB).json()
    assert [m["body"] for m in alice_view] == ["First", "Second"]
    assert [m["id"] for m in alice_view] == [m["id"] for m in bob_view]


def test_cannot_message_someone_you_are_not_connected_to(client, network):
    assert (
        client.post(
            "/api/connections/messages",
            json={"email": "carol@example.com", "body": "hello"},
            headers=ALICE,
        ).status_code
        == 422
    )


def test_empty_messages_are_rejected(client, network):
    assert (
        client.post(
            "/api/connections/messages", json={"email": "bob@example.com", "body": "   "}, headers=ALICE
        ).status_code
        == 422
    )


def test_inbox_lists_threads_with_unread_counts(client, network):
    client.post(
        "/api/connections/messages",
        json={"email": "bob@example.com", "body": "One"},
        headers=ALICE,
    )
    client.post(
        "/api/connections/messages",
        json={"email": "bob@example.com", "body": "Two"},
        headers=ALICE,
    )

    inbox = client.get("/api/connections/messages", headers=BOB).json()
    assert len(inbox) == 1
    assert inbox[0]["counterpart_name"] == "Alice Ng"
    assert inbox[0]["unread_count"] == 2
    assert inbox[0]["last_message"] == "Two"


def test_reading_a_thread_clears_its_unread_count(client, network):
    client.post(
        "/api/connections/messages",
        json={"email": "bob@example.com", "body": "One"},
        headers=ALICE,
    )
    client.get("/api/connections/messages/alice@example.com", headers=BOB)

    assert client.get("/api/connections/messages", headers=BOB).json()[0]["unread_count"] == 0


def test_a_stranger_sees_none_of_the_conversation(client, network):
    client.post(
        "/api/connections/messages",
        json={"email": "bob@example.com", "body": "Private"},
        headers=ALICE,
    )
    assert client.get("/api/connections/messages", headers=CAROL).json() == []
    assert client.get("/api/connections/messages/alice@example.com", headers=CAROL).json() == []


def test_a_message_can_reference_a_candidate(client, network):
    sent = client.post(
        "/api/connections/messages",
        json={"email": "bob@example.com", "body": "About Ada", "candidate_id": str(network.id)},
        headers=ALICE,
    ).json()
    assert sent["candidate_id"] == str(network.id)
