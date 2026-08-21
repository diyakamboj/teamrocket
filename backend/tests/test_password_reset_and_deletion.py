"""Forgotten passwords and account deletion."""

from datetime import datetime, timedelta, timezone

import pytest

from app.services import auth_service

ACCOUNT = {
    "email": "rosa@example.com",
    "password": "correct horse battery",
    "name": "Rosa Diaz",
    "department": "Talent",
}


def _register(client, **overrides):
    return client.post("/api/auth/register", json={**ACCOUNT, **overrides}).json()


def _reset_token(store, email):
    """The raw token is only ever returned to the caller, so tests reissue."""
    user = auth_service.find_by_email(store, email)
    return auth_service.issue_reset_token(store, user)


# ---------- forgot password ----------


def test_requesting_a_reset_answers_the_same_for_any_address(client):
    """Otherwise this becomes a way to discover who has an account."""
    _register(client)
    known = client.post("/api/auth/forgot-password", json={"email": ACCOUNT["email"]})
    unknown = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})

    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()


def test_a_reset_token_is_stored_hashed_not_in_the_clear(client, store):
    _register(client)
    token = _reset_token(store, ACCOUNT["email"])
    user = auth_service.find_by_email(store, ACCOUNT["email"])

    assert user.reset_token_hash and user.reset_token_hash != token
    assert auth_service.verify_password(token, user.reset_token_hash, user.reset_token_salt)


def test_a_valid_token_sets_the_new_password_and_signs_you_in(client, store):
    _register(client)
    token = _reset_token(store, ACCOUNT["email"])

    response = client.post(
        "/api/auth/reset-password",
        json={"token": token, "new_password": "a whole new passphrase"},
    )
    assert response.status_code == 200
    assert response.json()["token"]

    # The new password works and the old one does not.
    assert client.post(
        "/api/auth/login",
        json={"email": ACCOUNT["email"], "password": "a whole new passphrase"},
    ).status_code == 200
    # 422 is this app's convention for a refused credential, not 401.
    assert client.post(
        "/api/auth/login", json={"email": ACCOUNT["email"], "password": ACCOUNT["password"]}
    ).status_code == 422


def test_resetting_drops_every_existing_session(client, store):
    """Someone may be resetting *because* another party has access."""
    session = _register(client)
    old = {"Authorization": f"Bearer {session['token']}"}
    assert client.get("/api/auth/me", headers=old).status_code == 200

    token = _reset_token(store, ACCOUNT["email"])
    client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "a whole new passphrase"}
    )

    assert client.get("/api/auth/me", headers=old).status_code == 401


def test_a_token_cannot_be_used_twice(client, store):
    _register(client)
    token = _reset_token(store, ACCOUNT["email"])
    body = {"token": token, "new_password": "a whole new passphrase"}

    assert client.post("/api/auth/reset-password", json=body).status_code == 200
    assert client.post("/api/auth/reset-password", json=body).status_code == 422


def test_an_expired_token_is_refused(client, store):
    _register(client)
    token = _reset_token(store, ACCOUNT["email"])
    user = auth_service.find_by_email(store, ACCOUNT["email"])
    user.reset_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)
    store.users.save(user)

    response = client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "a whole new passphrase"}
    )
    assert response.status_code == 422


def test_issuing_a_second_link_invalidates_the_first(client, store):
    """Two working links in one inbox is one more than anybody needs."""
    _register(client)
    first = _reset_token(store, ACCOUNT["email"])
    _reset_token(store, ACCOUNT["email"])

    assert client.post(
        "/api/auth/reset-password",
        json={"token": first, "new_password": "a whole new passphrase"},
    ).status_code == 422


def test_a_weak_new_password_is_refused(client, store):
    _register(client)
    token = _reset_token(store, ACCOUNT["email"])
    assert client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "short"}
    ).status_code == 422


# ---------- account deletion ----------


def test_deleting_requires_the_current_password(client):
    session = _register(client)
    auth = {"Authorization": f"Bearer {session['token']}"}

    assert client.post(
        "/api/auth/delete-account", json={"password": "not the password"}, headers=auth
    ).status_code == 422
    # Still there.
    assert client.get("/api/auth/me", headers=auth).status_code == 200


def test_deleting_needs_a_session_at_all(client):
    assert client.post(
        "/api/auth/delete-account", json={"password": ACCOUNT["password"]}
    ).status_code == 401


def test_deleting_removes_the_account_and_what_it_owned(client, store):
    from app.models.candidate import Candidate
    from app.models.job_posting import JobPosting

    session = _register(client)
    auth = {"Authorization": f"Bearer {session['token']}"}

    store.candidates.save(
        Candidate(owner_email=ACCOUNT["email"], name="Ada Vance", email="ada@example.com")
    )
    store.jobs.save(JobPosting(title="Backend Engineer", description="d",
                               created_by=ACCOUNT["email"]))

    response = client.post(
        "/api/auth/delete-account", json={"password": ACCOUNT["password"]}, headers=auth
    )
    assert response.status_code == 204

    assert auth_service.find_by_email(store, ACCOUNT["email"]) is None
    # Nothing of theirs is left reachable by nobody.
    assert [c for c in store.candidates.list_all() if c.owner_email == ACCOUNT["email"]] == []
    assert [j for j in store.jobs.list_all() if j.created_by == ACCOUNT["email"]] == []
    assert client.get("/api/auth/me", headers=auth).status_code == 401


def test_deleting_does_not_touch_another_recruiters_records(client, store):
    from app.models.candidate import Candidate

    session = _register(client)
    store.candidates.save(
        Candidate(owner_email="someone.else@example.com", name="Theirs", email="t@example.com")
    )

    client.post(
        "/api/auth/delete-account",
        json={"password": ACCOUNT["password"]},
        headers={"Authorization": f"Bearer {session['token']}"},
    )
    assert [c.name for c in store.candidates.list_all()] == ["Theirs"]
