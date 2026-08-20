"""Moving candidates between roles, and adding internal employees directly."""

import uuid

from app.models.candidate import Candidate
from app.models.job_posting import JobPosting

OWNER = "recruiter@example.com"
HEADERS = {"X-Recruiter-Email": OWNER}


def _job(store, title):
    job = JobPosting(title=title, description="d", created_by=OWNER, required_skills=["Python"])
    store.jobs.save(job)
    return job


def _candidate(store, name, **kwargs):
    candidate = Candidate(
        owner_email=OWNER,
        name=name,
        email=f"{name.lower().replace(' ', '.')}@example.com",
        **kwargs,
    )
    store.candidates.save(candidate)
    return candidate


def test_a_candidate_can_be_moved_from_one_role_to_another(client, store):
    backend = _job(store, "Backend Engineer")
    platform = _job(store, "Platform Engineer")
    ada = _candidate(store, "Ada Vance", job_id=backend.id)

    response = client.put(
        f"/api/candidates/{ada.id}/role", json={"job_id": str(platform.id)}, headers=HEADERS
    )
    assert response.status_code == 200

    from app.services.job_pipeline_service import candidate_ids_for_job

    assert str(ada.id) in candidate_ids_for_job(store, platform)
    assert str(ada.id) not in candidate_ids_for_job(store, backend)


def test_removing_a_candidate_from_a_role_returns_them_to_the_pool(client, store):
    """Removing from a role is not deleting: they stay available."""
    backend = _job(store, "Backend Engineer")
    ada = _candidate(store, "Ada Vance", job_id=backend.id)

    response = client.put(f"/api/candidates/{ada.id}/role", json={"job_id": None}, headers=HEADERS)
    assert response.status_code == 200
    assert store.candidates.get(ada.id) is not None
    assert store.candidates.get(ada.id).job_id is None

    from app.services.job_pipeline_service import (
        candidate_ids_for_job,
        rankable_candidate_ids_for_job,
    )

    assert str(ada.id) not in candidate_ids_for_job(store, backend)
    # Back in the pool means rankable for any opening again.
    assert str(ada.id) in rankable_candidate_ids_for_job(store, backend)


def test_moving_off_a_board_drops_the_stage_placement(client, store):
    """A leftover placement would keep dragging them back onto the old board.

    An explicit placement is itself a membership route, so it has to go with
    the move — otherwise the candidate shows on both roles at once.
    """
    from app.models.placement import CandidatePlacement
    from app.services.job_pipeline_service import candidate_ids_for_job

    backend = _job(store, "Backend Engineer")
    platform = _job(store, "Platform Engineer")
    ada = _candidate(store, "Ada Vance", job_id=backend.id)
    store.candidate_placements.save(
        CandidatePlacement(
            id=uuid.uuid4(),
            job_id=backend.id,
            candidate_id=str(ada.id),
            candidate_name=ada.name,
            stage="interviewing",
            moved_by=OWNER,
        )
    )

    client.put(
        f"/api/candidates/{ada.id}/role", json={"job_id": str(platform.id)}, headers=HEADERS
    )
    assert str(ada.id) not in candidate_ids_for_job(store, backend)


def test_a_candidate_cannot_be_moved_onto_someone_elses_job(client, store):
    ada = _candidate(store, "Ada Vance")
    theirs = JobPosting(
        title="Their Role", description="d", created_by="someone.else@example.com"
    )
    store.jobs.save(theirs)

    response = client.put(
        f"/api/candidates/{ada.id}/role", json={"job_id": str(theirs.id)}, headers=HEADERS
    )
    assert response.status_code == 404


def test_an_internal_employee_can_be_created_without_a_resume(client, store):
    response = client.post(
        "/api/candidates/internal",
        json={
            "name": "Marcus Webb",
            "email": "marcus.webb@example.com",
            "title": "Staff Engineer",
            "current_assignment": "Payments platform",
            "skills": ["Go", "Kubernetes"],
        },
        headers=HEADERS,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["source"] == "internal"
    assert body["employment_status"] == "assigned"
    assert body["current_assignment"] == "Payments platform"


def test_an_internal_employee_can_be_created_straight_onto_the_bench(client, store):
    response = client.post(
        "/api/candidates/internal",
        json={"name": "Priya Raman", "email": "priya@example.com", "on_bench": True},
        headers=HEADERS,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["employment_status"] == "bench"
    assert body["bench_since"] is not None
    # Between assignments means no current assignment.
    assert body["current_assignment"] is None

    bench = client.get("/api/bench", headers=HEADERS).json()
    assert "Priya Raman" in [r["name"] for r in bench]


def test_a_duplicate_email_is_rejected_rather_than_creating_a_second_record(client, store):
    payload = {"name": "Ada Vance", "email": "ada@example.com"}
    assert client.post("/api/candidates/internal", json=payload, headers=HEADERS).status_code == 201
    assert client.post("/api/candidates/internal", json=payload, headers=HEADERS).status_code == 422


def test_an_internal_employee_can_be_created_directly_onto_a_role(client, store):
    from app.services.job_pipeline_service import candidate_ids_for_job

    backend = _job(store, "Backend Engineer")
    response = client.post(
        "/api/candidates/internal",
        json={"name": "Lena Vasquez", "email": "lena@example.com", "job_id": str(backend.id)},
        headers=HEADERS,
    )
    assert response.status_code == 201
    assert response.json()["id"] in candidate_ids_for_job(store, backend)
