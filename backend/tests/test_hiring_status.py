"""Hiring an candidate has to be visible everywhere, not just in the log.

"hired" used to exist only as a CandidateDecision row and a stage derived
from it, so the ranking list still offered "Hire" on someone already hired
and their résumé kept coming back in search.
"""

import uuid

from app.models.candidate import Candidate
from app.models.job_posting import JobPosting
from app.services.job_pipeline_service import (
    hired_candidates_for_job,
    rankable_candidate_ids_for_job,
)

OWNER = "recruiter@example.com"
HEADERS = {"X-Recruiter-Email": OWNER}


def _job(store, title="Backend Engineer"):
    job = JobPosting(title=title, description="d", created_by=OWNER, required_skills=["Python"])
    store.jobs.save(job)
    return job


def _candidate(store, name, **kwargs):
    c = Candidate(
        owner_email=OWNER,
        name=name,
        email=f"{name.lower().replace(' ', '.')}@example.com",
        **kwargs,
    )
    store.candidates.save(c)
    return c


def test_a_new_candidate_is_active(store):
    assert _candidate(store, "Ada Vance").hiring_status == "active"


def test_hiring_marks_the_candidate_and_stops_them_being_rankable(client, store):
    job = _job(store)
    ada = _candidate(store, "Ada Vance", job_id=job.id)
    assert str(ada.id) in rankable_candidate_ids_for_job(store, job)

    response = client.post(
        "/api/candidates/decision",
        json={
            "candidate_id": str(ada.id),
            "name": ada.name,
            "email": ada.email,
            "job_title": job.title,
            "decision": "hired",
        },
        headers=HEADERS,
    )
    assert response.status_code == 200

    hired = store.candidates.get(ada.id)
    assert hired.hiring_status == "hired"
    assert hired.hired_at is not None
    # No longer an open candidate — this is what removed the second
    # "Hire" button from someone already hired.
    assert str(ada.id) not in rankable_candidate_ids_for_job(store, job)


def test_a_hired_person_becomes_an_employee_on_that_assignment(client, store):
    job = _job(store)
    ada = _candidate(store, "Ada Vance", job_id=job.id, source="external")
    client.post(
        "/api/candidates/decision",
        json={
            "candidate_id": str(ada.id),
            "name": ada.name,
            "email": ada.email,
            "job_title": job.title,
            "decision": "hired",
        },
        headers=HEADERS,
    )
    hired = store.candidates.get(ada.id)
    assert hired.source == "internal"
    assert hired.employment_status == "assigned"
    assert hired.current_assignment == job.title


def test_the_role_can_list_who_it_hired(client, store):
    job = _job(store)
    ada = _candidate(store, "Ada Vance", job_id=job.id)
    client.post(
        "/api/candidates/decision",
        json={
            "candidate_id": str(ada.id),
            "name": ada.name,
            "email": ada.email,
            "job_title": job.title,
            "decision": "hired",
        },
        headers=HEADERS,
    )
    assert [c.name for c in hired_candidates_for_job(store, job)] == ["Ada Vance"]

    listed = client.get(f"/api/dashboard/jobs/{job.id}/hired", headers=HEADERS).json()
    assert [r["name"] for r in listed] == ["Ada Vance"]


def test_rejecting_also_takes_them_out_of_the_running(client, store):
    job = _job(store)
    ada = _candidate(store, "Ada Vance", job_id=job.id)
    client.post(
        "/api/candidates/decision",
        json={
            "candidate_id": str(ada.id),
            "name": ada.name,
            "email": ada.email,
            "job_title": job.title,
            "decision": "rejected",
        },
        headers=HEADERS,
    )
    assert store.candidates.get(ada.id).hiring_status == "rejected"
    assert str(ada.id) not in rankable_candidate_ids_for_job(store, job)


def test_advancing_leaves_them_active(client, store):
    job = _job(store)
    ada = _candidate(store, "Ada Vance", job_id=job.id)
    client.post(
        "/api/candidates/decision",
        json={
            "candidate_id": str(ada.id),
            "name": ada.name,
            "email": ada.email,
            "job_title": job.title,
            "decision": "advanced",
        },
        headers=HEADERS,
    )
    assert store.candidates.get(ada.id).hiring_status == "active"
    assert str(ada.id) in rankable_candidate_ids_for_job(store, job)


def test_an_assessment_can_be_explicitly_skipped(client, store):
    """A blank row cannot say whether skipping was a decision or an oversight."""
    job = _job(store)
    ada = _candidate(store, "Ada Vance", job_id=job.id)

    response = client.post(
        "/api/readiness/skip",
        json={
            "candidate_id": str(ada.id),
            "job_id": str(job.id),
            "job_title": job.title,
            "reason": "Strong referral, assessed by the hiring manager already",
        },
        headers=HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "skipped"
    assert body["skipped_by"] == OWNER
    assert "referral" in body["skip_reason"]
