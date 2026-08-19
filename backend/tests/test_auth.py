"""Registration, sign-in and session verification.

The security properties are the point: passwords are never stored or returned
in the clear, a wrong password is indistinguishable from an unknown account,
and a session claim is only trusted because the server can verify the token.
"""

import pytest

from app.services import auth_service


ACCOUNT = {
    "email": "rita@example.com",
    "password": "correct horse battery",
    "name": "Rita Chen",
    "role": "Technical Recruiter",
    "department": "Talent",
}


def register(client, **overrides):
    return client.post("/api/auth/register", json={**ACCOUNT, **overrides})


# ---------- registration ----------


def test_registration_returns_a_session_and_the_public_account(client):
    response = register(client)
    assert response.status_code == 201
    body = response.json()

    assert body["token"]
    assert body["user"]["email"] == "rita@example.com"
    assert body["user"]["name"] == "Rita Chen"


def test_registration_never_returns_the_password_or_its_hash(client):
    body = register(client).json()
    serialized = str(body)

    assert ACCOUNT["password"] not in serialized
    assert "password_hash" not in serialized
    assert "password_salt" not in serialized


def test_password_is_not_stored_in_the_clear(client, store):
    register(client)
    user = store.users.list_all()[0]

    assert user.password_hash != ACCOUNT["password"]
    assert ACCOUNT["password"] not in user.password_hash
    assert user.password_salt


def test_duplicate_email_is_rejected(client):
    register(client)
    second = register(client, name="Someone Else")

    assert second.status_code == 422
    assert "already exists" in second.json()["error"]


def test_email_is_normalised_so_case_cannot_duplicate_an_account(client):
    register(client)
    assert register(client, email="RITA@example.com").status_code == 422


@pytest.mark.parametrize("password", ["short", "  ", "1234567"])
def test_weak_passwords_are_rejected(client, password):
    assert register(client, password=password).status_code == 422


@pytest.mark.parametrize("email", ["not-an-email", "", "a@b"])
def test_invalid_emails_are_rejected(client, email):
    assert register(client, email=email).status_code == 422


def test_name_is_required(client):
    assert register(client, name="   ").status_code == 422


# ---------- sign in ----------


def test_login_with_the_right_password_returns_a_session(client):
    register(client)
    response = client.post(
        "/api/auth/login", json={"email": ACCOUNT["email"], "password": ACCOUNT["password"]}
    )

    assert response.status_code == 200
    assert response.json()["token"]


def test_login_with_a_wrong_password_is_rejected(client):
    register(client)
    response = client.post(
        "/api/auth/login", json={"email": ACCOUNT["email"], "password": "not the password"}
    )
    assert response.status_code == 422


def test_unknown_account_and_wrong_password_are_indistinguishable(client):
    register(client)
    wrong_password = client.post(
        "/api/auth/login", json={"email": ACCOUNT["email"], "password": "nope"}
    )
    unknown_account = client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "nope"}
    )

    assert wrong_password.status_code == unknown_account.status_code
    assert wrong_password.json()["error"] == unknown_account.json()["error"]


def test_signing_in_twice_keeps_the_first_session_alive(client):
    first = register(client).json()["token"]
    second = client.post(
        "/api/auth/login", json={"email": ACCOUNT["email"], "password": ACCOUNT["password"]}
    ).json()["token"]

    assert first != second
    for token in (first, second):
        assert (
            client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code
            == 200
        )


# ---------- session verification ----------


def test_me_returns_the_account_for_a_valid_token(client):
    token = register(client).json()["token"]
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["email"] == ACCOUNT["email"]


@pytest.mark.parametrize(
    "header", [None, "", "Bearer", "Bearer wrong-token", "Basic abc", "wrong-token"]
)
def test_me_rejects_anything_but_a_real_token(client, header):
    headers = {"Authorization": header} if header is not None else {}
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_logout_invalidates_only_that_session(client):
    first = register(client).json()["token"]
    second = client.post(
        "/api/auth/login", json={"email": ACCOUNT["email"], "password": ACCOUNT["password"]}
    ).json()["token"]

    assert client.post("/api/auth/logout", headers={"Authorization": f"Bearer {first}"}).status_code == 204
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {first}"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {second}"}).status_code == 200


# ---------- hashing ----------


def test_the_same_password_hashes_differently_for_two_accounts(client, store):
    register(client)
    register(client, email="sam@example.com", name="Sam")

    hashes = {u.password_hash for u in store.users.list_all()}
    assert len(hashes) == 2, "a shared salt would make identical passwords obvious"


def test_verify_password_accepts_only_the_original():
    digest, salt = auth_service.hash_password("a good password")
    assert auth_service.verify_password("a good password", digest, salt)
    assert not auth_service.verify_password("a good passworD", digest, salt)
