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
    # Not for *this* role — an explicit removal has to stick, or the next
    # ranking run would put them straight back.
    assert str(ada.id) not in rankable_candidate_ids_for_job(store, backend)

    # But they are still in the pool and available to every other role.
    other = _job(store, "Platform Engineer")
    assert str(ada.id) in rankable_candidate_ids_for_job(store, other)


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


def test_removing_from_a_role_takes_them_off_that_board(client, store):
    """A pool candidate reaches a board by having been scored against it.

    Clearing `job_id` alone left them sitting there, so "Remove from role"
    reported success while the person visibly stayed — the button looked
    broken.
    """
    from app.models.evaluation import Evaluation
    from app.services.job_pipeline_service import candidate_ids_for_job

    backend = _job(store, "Backend Engineer")
    pooled = _candidate(store, "Grace Hopper", job_id=None)
    store.evaluations.save(
        Evaluation(job_id=backend.id, candidate_id=pooled.id, overall_score=80)
    )
    assert str(pooled.id) in candidate_ids_for_job(store, backend)

    response = client.put(
        f"/api/candidates/{pooled.id}/role",
        json={"job_id": None, "from_job_id": str(backend.id)},
        headers=HEADERS,
    )
    assert response.status_code == 200
    assert str(pooled.id) not in candidate_ids_for_job(store, backend)
    # Still in the pool — removal is not deletion.
    assert store.candidates.get(pooled.id) is not None


def test_moving_to_another_role_also_clears_the_old_board(client, store):
    from app.models.evaluation import Evaluation
    from app.services.job_pipeline_service import candidate_ids_for_job

    backend = _job(store, "Backend Engineer")
    platform = _job(store, "Platform Engineer")
    ada = _candidate(store, "Ada Vance", job_id=backend.id)
    store.evaluations.save(Evaluation(job_id=backend.id, candidate_id=ada.id, overall_score=90))

    client.put(
        f"/api/candidates/{ada.id}/role",
        json={"job_id": str(platform.id), "from_job_id": str(backend.id)},
        headers=HEADERS,
    )
    assert str(ada.id) not in candidate_ids_for_job(store, backend)
    assert str(ada.id) in candidate_ids_for_job(store, platform)


def test_a_removal_survives_the_next_ranking_run(client, store):
    """Ranking re-scores every unassigned pool candidate.

    Clearing the evaluation alone therefore undid the removal on the next
    run: the person reappeared on the board they had just been taken off.
    """
    from app.models.evaluation import Evaluation
    from app.services.job_pipeline_service import (
        candidate_ids_for_job,
        rankable_candidate_ids_for_job,
    )

    backend = _job(store, "Backend Engineer")
    pooled = _candidate(store, "Grace Hopper", job_id=None)
    store.evaluations.save(
        Evaluation(job_id=backend.id, candidate_id=pooled.id, overall_score=80)
    )

    client.put(
        f"/api/candidates/{pooled.id}/role",
        json={"job_id": None, "from_job_id": str(backend.id)},
        headers=HEADERS,
    )

    assert str(pooled.id) not in candidate_ids_for_job(store, backend)
    # The decisive part: ranking must not pull them back in.
    assert str(pooled.id) not in rankable_candidate_ids_for_job(store, backend)


def test_putting_them_back_on_the_role_clears_the_removal(client, store):
    from app.services.job_pipeline_service import candidate_ids_for_job

    backend = _job(store, "Backend Engineer")
    pooled = _candidate(store, "Grace Hopper", job_id=None)

    client.put(
        f"/api/candidates/{pooled.id}/role",
        json={"job_id": None, "from_job_id": str(backend.id)},
        headers=HEADERS,
    )
    client.put(
        f"/api/candidates/{pooled.id}/role",
        json={"job_id": str(backend.id)},
        headers=HEADERS,
    )
    assert str(pooled.id) in candidate_ids_for_job(store, backend)
    assert store.candidates.get(pooled.id).excluded_job_ids == []
