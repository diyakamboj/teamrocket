"""Candidates belong to the role their résumé was uploaded for.

Membership used to be "has an evaluation for this job". Ranking a job scores
the whole pool, so a single ranking run put every candidate on every board --
a résumé uploaded for Backend Engineer showed up under Platform Engineer too,
which is what made the boards meaningless.
"""

import uuid

import pytest

from app.models.candidate import Candidate
from app.models.job_posting import JobPosting
from app.services.job_pipeline_service import (
    candidate_ids_for_job,
    get_job_pipeline_candidates,
    rankable_candidate_ids_for_job,
)

OWNER = "recruiter@example.com"


def _job(store, title):
    job = JobPosting(title=title, description="d", created_by=OWNER, required_skills=["Python"])
    store.jobs.save(job)
    return job


def _candidate(store, name, job_id=None, source="external", employment_status=None):
    candidate = Candidate(
        owner_email=OWNER,
        name=name,
        email=f"{name.lower().replace(' ', '.')}@example.com",
        job_id=job_id,
        source=source,
        employment_status=employment_status,
        resume_text="Python engineer",
    )
    store.candidates.save(candidate)
    return candidate


def test_a_candidate_appears_only_on_the_job_they_were_uploaded_for(store):
    backend = _job(store, "Backend Engineer")
    platform = _job(store, "Platform Engineer")
    ada = _candidate(store, "Ada Vance", job_id=backend.id)

    assert str(ada.id) in candidate_ids_for_job(store, backend)
    assert str(ada.id) not in candidate_ids_for_job(store, platform)


def test_scoring_against_another_role_does_not_move_them_onto_its_board(store):
    """The exact regression: an evaluation alone must not confer membership."""
    from app.models.evaluation import Evaluation

    backend = _job(store, "Backend Engineer")
    platform = _job(store, "Platform Engineer")
    ada = _candidate(store, "Ada Vance", job_id=backend.id)

    store.evaluations.save(
        Evaluation(job_id=platform.id, candidate_id=ada.id, overall_score=91)
    )

    assert str(ada.id) not in candidate_ids_for_job(store, platform)
    names = [row["candidate_name"] for row in get_job_pipeline_candidates(store, platform)]
    assert "Ada Vance" not in names


def test_a_pool_candidate_with_no_role_can_still_be_ranked_for_any_job(store):
    """Being scored is how an unassigned candidate joins a board.

    Restricting ranking to existing members would mean they could never
    enter one.
    """
    backend = _job(store, "Backend Engineer")
    pooled = _candidate(store, "Grace Hopper", job_id=None)

    assert str(pooled.id) not in candidate_ids_for_job(store, backend)
    assert str(pooled.id) in rankable_candidate_ids_for_job(store, backend)


def test_a_pool_candidate_joins_the_board_once_scored_there(store):
    from app.models.evaluation import Evaluation

    backend = _job(store, "Backend Engineer")
    pooled = _candidate(store, "Grace Hopper", job_id=None)
    store.evaluations.save(
        Evaluation(job_id=backend.id, candidate_id=pooled.id, overall_score=80)
    )
    assert str(pooled.id) in candidate_ids_for_job(store, backend)


def test_a_candidate_owned_by_another_role_is_never_rankable_here(store):
    backend = _job(store, "Backend Engineer")
    platform = _job(store, "Platform Engineer")
    ada = _candidate(store, "Ada Vance", job_id=backend.id)

    assert str(ada.id) not in rankable_candidate_ids_for_job(store, platform)


def test_an_explicit_placement_still_puts_someone_on_a_board(store):
    """A recruiter moving a candidate by hand overrides where they came from."""
    from app.models.placement import CandidatePlacement

    backend = _job(store, "Backend Engineer")
    platform = _job(store, "Platform Engineer")
    ada = _candidate(store, "Ada Vance", job_id=backend.id)

    store.candidate_placements.save(
        CandidatePlacement(
            id=uuid.uuid4(),
            job_id=platform.id,
            candidate_id=str(ada.id),
            candidate_name=ada.name,
            stage="interviewing",
            moved_by=OWNER,
        )
    )
    assert str(ada.id) in candidate_ids_for_job(store, platform)


def test_internal_and_external_candidates_stay_separated(store):
    backend = _job(store, "Backend Engineer")
    _candidate(store, "Internal Person", job_id=backend.id, source="internal")
    _candidate(store, "External Person", job_id=backend.id, source="external")

    internal = [r["candidate_name"] for r in get_job_pipeline_candidates(store, backend, "internal")]
    external = [r["candidate_name"] for r in get_job_pipeline_candidates(store, backend, "external")]

    assert internal == ["Internal Person"]
    assert external == ["External Person"]


def test_one_recruiters_candidates_never_reach_another_recruiters_job(store):
    backend = _job(store, "Backend Engineer")
    stranger = Candidate(
        owner_email="someone.else@example.com",
        name="Stranger",
        email="stranger@example.com",
        job_id=None,
    )
    store.candidates.save(stranger)

    assert str(stranger.id) not in rankable_candidate_ids_for_job(store, backend)
    assert str(stranger.id) not in candidate_ids_for_job(store, backend)


# ---------- bench ----------


def test_an_external_candidate_cannot_be_placed_on_the_bench(client, store):
    """The bench is internal employees between assignments.

    Placing used to set source="internal" on whoever was passed, so benching
    an external applicant silently reclassified them and the two pools
    stopped being separate.
    """
    applicant = _candidate(store, "External Applicant", source="external")
    response = client.post(
        f"/api/bench/{applicant.id}/place",
        json={"previous_assignment": "n/a"},
        headers={"X-Recruiter-Email": OWNER},
    )
    assert response.status_code == 422

    unchanged = store.candidates.get(applicant.id)
    assert unchanged.source == "external"
    assert unchanged.employment_status is None


def test_an_internal_employee_can_be_placed_on_the_bench(client, store):
    employee = _candidate(store, "Internal Employee", source="internal")
    response = client.post(
        f"/api/bench/{employee.id}/place",
        json={"previous_assignment": "Data platform"},
        headers={"X-Recruiter-Email": OWNER},
    )
    assert response.status_code == 200

    benched = store.candidates.get(employee.id)
    assert benched.employment_status == "bench"
    assert benched.bench_since is not None


def test_the_bench_lists_only_internal_people_on_it(client, store):
    _candidate(store, "On Bench", source="internal", employment_status="bench")
    _candidate(store, "Assigned Employee", source="internal", employment_status="assigned")
    _candidate(store, "Outside Applicant", source="external")

    rows = client.get("/api/bench", headers={"X-Recruiter-Email": OWNER}).json()
    assert [r["name"] for r in rows] == ["On Bench"]
