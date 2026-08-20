"""Recruiter directory and connection requests.

The access rules matter: the directory exposes only what you need to decide
whether to connect, and a request can only be answered by the person it was
sent to.
"""

import uuid

import pytest

from app.models.user import User

ALICE = {"X-Recruiter-Email": "alice@example.com"}
BOB = {"X-Recruiter-Email": "bob@example.com"}
CAROL = {"X-Recruiter-Email": "carol@example.com"}


@pytest.fixture()
def recruiters(store):
    for email, name, role in [
        ("alice@example.com", "Alice Ng", "Technical Recruiter"),
        ("bob@example.com", "Bob Silva", "Engineering Recruiter"),
        ("carol@example.com", "Carol Diaz", "Talent Partner"),
    ]:
        store.users.save(
            User(email=email, name=name, role=role, password_hash="x", password_salt="y")
        )
    return store


# ---------- directory ----------


def test_directory_lists_other_recruiters_but_not_you(client, recruiters):
    entries = client.get("/api/connections/directory", headers=ALICE).json()
    emails = {e["email"] for e in entries}

    assert emails == {"bob@example.com", "carol@example.com"}


def test_directory_never_exposes_credentials(client, recruiters):
    entries = client.get("/api/connections/directory", headers=ALICE).json()
    serialized = str(entries)

    assert "password_hash" not in serialized
    assert "password_salt" not in serialized
    assert "session_tokens" not in serialized


def test_directory_shows_connection_state(client, recruiters):
    client.post("/api/connections", json={"email": "bob@example.com"}, headers=ALICE)

    by_email = {e["email"]: e for e in client.get("/api/connections/directory", headers=ALICE).json()}
    assert by_email["bob@example.com"]["connection_state"] == "pending_outgoing"
    assert by_email["carol@example.com"]["connection_state"] == "none"

    bobs_view = {e["email"]: e for e in client.get("/api/connections/directory", headers=BOB).json()}
    assert bobs_view["alice@example.com"]["connection_state"] == "pending_incoming"


# ---------- requesting ----------


def test_request_creates_a_pending_connection_for_both_sides(client, recruiters):
    response = client.post(
        "/api/connections",
        json={"email": "bob@example.com", "message": "Both screening platform engineers"},
        headers=ALICE,
    )
    assert response.status_code == 201
    assert response.json()["status"] == "pending"
    assert response.json()["direction"] == "outgoing"

    incoming = client.get("/api/connections", headers=BOB).json()
    assert incoming[0]["direction"] == "incoming"
    assert incoming[0]["counterpart_name"] == "Alice Ng"
    assert incoming[0]["message"] == "Both screening platform engineers"


def test_cannot_connect_with_yourself(client, recruiters):
    assert (
        client.post("/api/connections", json={"email": "alice@example.com"}, headers=ALICE).status_code
        == 422
    )


def test_cannot_connect_with_an_unknown_recruiter(client, recruiters):
    assert (
        client.post("/api/connections", json={"email": "nobody@example.com"}, headers=ALICE).status_code
        == 404
    )


def test_duplicate_requests_are_rejected(client, recruiters):
    client.post("/api/connections", json={"email": "bob@example.com"}, headers=ALICE)
    second = client.post("/api/connections", json={"email": "bob@example.com"}, headers=ALICE)

    assert second.status_code == 422
    assert "pending" in second.json()["error"]


def test_a_request_the_other_way_is_also_a_duplicate(client, recruiters):
    client.post("/api/connections", json={"email": "bob@example.com"}, headers=ALICE)
    assert (
        client.post("/api/connections", json={"email": "alice@example.com"}, headers=BOB).status_code
        == 422
    )


# ---------- responding ----------


def test_addressee_can_accept(client, recruiters):
    request_id = client.post(
        "/api/connections", json={"email": "bob@example.com"}, headers=ALICE
    ).json()["id"]

    response = client.post(f"/api/connections/{request_id}/respond", json={"accept": True}, headers=BOB)
    assert response.status_code == 200
    assert response.json()["status"] == "accepted"

    directory = {e["email"]: e for e in client.get("/api/connections/directory", headers=ALICE).json()}
    assert directory["bob@example.com"]["connection_state"] == "connected"


def test_addressee_can_decline(client, recruiters):
    request_id = client.post(
        "/api/connections", json={"email": "bob@example.com"}, headers=ALICE
    ).json()["id"]

    assert (
        client.post(f"/api/connections/{request_id}/respond", json={"accept": False}, headers=BOB)
        .json()["status"]
        == "declined"
    )


def test_the_requester_cannot_accept_their_own_request(client, recruiters):
    request_id = client.post(
        "/api/connections", json={"email": "bob@example.com"}, headers=ALICE
    ).json()["id"]

    assert (
        client.post(f"/api/connections/{request_id}/respond", json={"accept": True}, headers=ALICE)
        .status_code
        == 404
    )


def test_an_unrelated_recruiter_cannot_answer_or_see_it(client, recruiters):
    request_id = client.post(
        "/api/connections", json={"email": "bob@example.com"}, headers=ALICE
    ).json()["id"]

    assert (
        client.post(f"/api/connections/{request_id}/respond", json={"accept": True}, headers=CAROL)
        .status_code
        == 404
    )
    assert client.get("/api/connections", headers=CAROL).json() == []


def test_answering_twice_is_rejected(client, recruiters):
    request_id = client.post(
        "/api/connections", json={"email": "bob@example.com"}, headers=ALICE
    ).json()["id"]
    client.post(f"/api/connections/{request_id}/respond", json={"accept": True}, headers=BOB)

    assert (
        client.post(f"/api/connections/{request_id}/respond", json={"accept": True}, headers=BOB)
        .status_code
        == 422
    )


# ---------- removing ----------


def test_either_side_can_disconnect(client, recruiters):
    request_id = client.post(
        "/api/connections", json={"email": "bob@example.com"}, headers=ALICE
    ).json()["id"]
    client.post(f"/api/connections/{request_id}/respond", json={"accept": True}, headers=BOB)

    assert client.delete(f"/api/connections/{request_id}", headers=ALICE).status_code == 204
    assert client.get("/api/connections", headers=BOB).json() == []


def test_a_stranger_cannot_delete_a_connection(client, recruiters):
    request_id = client.post(
        "/api/connections", json={"email": "bob@example.com"}, headers=ALICE
    ).json()["id"]

    assert client.delete(f"/api/connections/{request_id}", headers=CAROL).status_code == 404


def test_unknown_connection_is_404(client, recruiters):
    assert client.delete(f"/api/connections/{uuid.uuid4()}", headers=ALICE).status_code == 404
