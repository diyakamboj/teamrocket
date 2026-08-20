"""Bench employees: availability, duration, and matching to roles."""

from datetime import datetime, timedelta, timezone

import pytest

from app.models.candidate import Candidate
from app.models.job_posting import JobPosting

ALICE = {"X-Recruiter-Email": "alice@example.com"}
BOB = {"X-Recruiter-Email": "bob@example.com"}


def _candidate(store, name, owner="alice@example.com", **kwargs) -> Candidate:
    candidate = Candidate(
        owner_email=owner,
        name=name,
        email=f"{name.lower().replace(' ', '.')}@example.com",
        source="internal",
        **kwargs,
    )
    store.candidates.save(candidate)
    return candidate


def test_bench_list_is_empty_without_bench_employees(client, store):
    _candidate(store, "Assigned Person", employment_status="assigned")
    assert client.get("/api/bench", headers=ALICE).json() == []


def test_placing_someone_on_the_bench_lists_them(client, store):
    person = _candidate(store, "Maya Okonkwo", employment_status="assigned",
                        current_assignment="Project Atlas")

    placed = client.post(
        f"/api/bench/{person.id}/place",
        json={"previous_assignment": "Project Atlas"},
        headers=ALICE,
    )
    assert placed.status_code == 200

    bench = client.get("/api/bench", headers=ALICE).json()
    assert [b["name"] for b in bench] == ["Maya Okonkwo"]
    assert bench[0]["previous_assignment"] == "Project Atlas"


def test_bench_start_date_is_stamped_so_duration_is_answerable(client, store):
    person = _candidate(store, "Maya Okonkwo")
    client.post(f"/api/bench/{person.id}/place", json={}, headers=ALICE)

    assert store.candidates.get(person.id).bench_since is not None
    assert client.get("/api/bench", headers=ALICE).json()[0]["days_on_bench"] == 0


def test_days_on_bench_counts_from_the_recorded_date(client, store):
    _candidate(
        store,
        "Long Waiter",
        employment_status="bench",
        bench_since=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=45),
    )
    assert client.get("/api/bench", headers=ALICE).json()[0]["days_on_bench"] == 45


def test_longest_waiting_is_listed_first(client, store):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    _candidate(store, "Recent", employment_status="bench", bench_since=now - timedelta(days=3))
    _candidate(store, "Longest", employment_status="bench", bench_since=now - timedelta(days=60))
    _candidate(store, "Middle", employment_status="bench", bench_since=now - timedelta(days=20))

    assert [b["name"] for b in client.get("/api/bench", headers=ALICE).json()] == [
        "Longest",
        "Middle",
        "Recent",
    ]


def test_unknown_bench_start_sorts_last_not_as_zero(client, store):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    _candidate(store, "Known", employment_status="bench", bench_since=now - timedelta(days=5))
    _candidate(store, "Unknown", employment_status="bench")

    bench = client.get("/api/bench", headers=ALICE).json()
    assert [b["name"] for b in bench] == ["Known", "Unknown"]
    assert bench[1]["days_on_bench"] is None


def test_assigning_clears_the_bench_and_records_the_project(client, store):
    person = _candidate(store, "Maya Okonkwo", employment_status="bench")

    assigned = client.post(
        f"/api/bench/{person.id}/assign", json={"assignment": "Project Beacon"}, headers=ALICE
    )
    assert assigned.status_code == 200

    saved = store.candidates.get(person.id)
    assert saved.employment_status == "assigned"
    assert saved.current_assignment == "Project Beacon"
    assert saved.bench_since is None
    assert client.get("/api/bench", headers=ALICE).json() == []


def test_assignment_needs_a_name(client, store):
    person = _candidate(store, "Maya Okonkwo", employment_status="bench")
    assert (
        client.post(f"/api/bench/{person.id}/assign", json={"assignment": "  "}, headers=ALICE)
        .status_code
        == 422
    )


def test_bench_is_scoped_to_the_recruiter(client, store):
    _candidate(store, "Mine", owner="alice@example.com", employment_status="bench")
    _candidate(store, "Theirs", owner="bob@example.com", employment_status="bench")

    assert [b["name"] for b in client.get("/api/bench", headers=ALICE).json()] == ["Mine"]


def test_cannot_bench_another_recruiters_person(client, store):
    theirs = _candidate(store, "Theirs", owner="bob@example.com")
    assert client.post(f"/api/bench/{theirs.id}/place", json={}, headers=ALICE).status_code == 404


# ---------- matching ----------


def test_matching_requires_a_job_or_a_query(client, store):
    assert client.get("/api/bench/match", headers=ALICE).status_code == 422


def test_matching_ranks_bench_employees_against_a_role(client, store, monkeypatch):
    from app.services import vector_store as vector_module

    monkeypatch.setattr(vector_module, "document_store", store.candidates._store)
    monkeypatch.setattr(vector_module.openai_service, "embeddings_mock", False)

    AXES = ["kubernetes", "react"]
    monkeypatch.setattr(
        vector_module.openai_service,
        "embed_texts",
        lambda texts: [[1.0 if a in t.lower() else 0.0 for a in AXES] for t in texts],
    )

    sre = _candidate(store, "Maya Okonkwo", employment_status="bench", skills=["Kubernetes"])
    fe = _candidate(store, "Theo Marchetti", employment_status="bench", skills=["React"])
    for person in (sre, fe):
        vector_module.index_candidate(person)

    job = JobPosting(
        title="Platform Engineer",
        description="Kubernetes platform team",
        required_skills=["Kubernetes"],
        created_by="alice@example.com",
    )
    store.jobs.save(job)

    matches = client.get(f"/api/bench/match?job_id={job.id}", headers=ALICE).json()
    assert matches[0]["name"] == "Maya Okonkwo"
    assert matches[0]["similarity"] > 0


def test_matching_only_returns_your_own_bench(client, store, monkeypatch):
    from app.services import vector_store as vector_module

    monkeypatch.setattr(vector_module, "document_store", store.candidates._store)
    monkeypatch.setattr(vector_module.openai_service, "embeddings_mock", False)
    monkeypatch.setattr(vector_module.openai_service, "embed_texts", lambda texts: [[1.0] for _ in texts])

    theirs = _candidate(store, "Theirs", owner="bob@example.com", employment_status="bench")
    vector_module.index_candidate(theirs)

    assert client.get("/api/bench/match?q=anything", headers=ALICE).json() == []
