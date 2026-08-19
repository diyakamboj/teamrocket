"""Can a recruiter actually move a candidate through the pipeline?

Not "does the page render" — these drive the real transitions and assert the
stage the rest of the app reads back afterwards, so an action that only looks
like it worked fails here.
"""

import uuid

import pytest

from app.models.candidate import Candidate
from app.models.job_posting import JobPosting

RECRUITER = {"X-Recruiter-Email": "recruiter@example.com"}


@pytest.fixture()
def pipeline(store):
    job = JobPosting(
        title="Platform Engineer",
        description="Python, Kubernetes and SQL.",
        required_skills=["Python", "Kubernetes", "SQL"],
        created_by="recruiter@example.com",
    )
    store.jobs.save(job)
    candidate = Candidate(
        owner_email="recruiter@example.com",
        name="Ada Vance",
        email="ada.vance@example.com",
        skills=["Python", "Kubernetes", "SQL"],
        resume_text="Ada Vance. Ran multi-region Kubernetes clusters for four years.",
    )
    store.candidates.save(candidate)
    return job, candidate


def stage_of(client, job, candidate) -> str | None:
    rows = client.get(f"/api/dashboard/jobs/{job.id}/pipeline?source=all", headers=RECRUITER).json()
    return next(
        (r["stage"] for r in rows if str(r["candidate_id"]) == str(candidate.id)),
        None,
    )


def decide(client, candidate, job, decision):
    return client.post(
        "/api/candidates/decision",
        json={
            "candidate_id": str(candidate.id),
            "name": candidate.name,
            "email": candidate.email,
            "decision": decision,
            "job_title": job.title,
        },
        headers=RECRUITER,
    )


# ---------- the transitions a recruiter needs ----------


def test_candidate_starts_screened_in_the_pipeline(client, pipeline):
    job, candidate = pipeline
    client.get(f"/api/candidates/rank?job_id={job.id}", headers=RECRUITER)

    assert stage_of(client, job, candidate) == "screened"


def test_advance_to_next_round_moves_the_candidate(client, pipeline):
    job, candidate = pipeline
    client.get(f"/api/candidates/rank?job_id={job.id}", headers=RECRUITER)

    assert decide(client, candidate, job, "advanced").status_code == 200
    assert stage_of(client, job, candidate) == "interviewing"


def test_approve_selects_the_candidate(client, pipeline):
    job, candidate = pipeline
    client.get(f"/api/candidates/rank?job_id={job.id}", headers=RECRUITER)

    assert decide(client, candidate, job, "approved").status_code == 200
    assert stage_of(client, job, candidate) == "selected"


def test_hire_is_a_real_terminal_state(client, pipeline):
    """"Hire" used to be rejected outright, so a pipeline could never close."""
    job, candidate = pipeline
    client.get(f"/api/candidates/rank?job_id={job.id}", headers=RECRUITER)

    assert decide(client, candidate, job, "hired").status_code == 200
    assert stage_of(client, job, candidate) == "hired"


def test_reject_moves_the_candidate_out(client, pipeline):
    job, candidate = pipeline
    client.get(f"/api/candidates/rank?job_id={job.id}", headers=RECRUITER)

    assert decide(client, candidate, job, "rejected").status_code == 200
    assert stage_of(client, job, candidate) == "rejected"


def test_an_unknown_decision_is_rejected(client, pipeline):
    job, candidate = pipeline
    assert decide(client, candidate, job, "promoted").status_code == 422


def test_the_latest_decision_wins(client, pipeline):
    """A candidate advanced and then hired must read as hired, not stick."""
    job, candidate = pipeline
    client.get(f"/api/candidates/rank?job_id={job.id}", headers=RECRUITER)

    decide(client, candidate, job, "advanced")
    decide(client, candidate, job, "hired")
    assert stage_of(client, job, candidate) == "hired"


def test_decisions_are_persisted_not_just_emailed(client, pipeline, store):
    job, candidate = pipeline
    decide(client, candidate, job, "advanced")

    saved = store.candidate_decisions.list_all()
    assert [d.decision for d in saved] == ["advanced"]
    assert saved[0].candidate_email == candidate.email


# ---------- screening feeds the pipeline ----------


def test_screening_session_completes_and_produces_a_summary(client, pipeline):
    job, candidate = pipeline
    session = client.post(
        "/api/screening/session",
        json={"candidate_id": str(candidate.id), "job_id": str(job.id)},
        headers=RECRUITER,
    ).json()

    for question in session["questions"]:
        session = client.post(
            "/api/screening/answer",
            json={
                "session_id": session["id"],
                "question_id": question["id"],
                "answer_text": "I ran multi-region Kubernetes clusters, owning rollout and incident response.",
            },
            headers=RECRUITER,
        ).json()

    assert session["status"] == "completed"
    assert session["summary_pack"], "a completed screen must produce a summary pack"
    assert client.get(f"/api/screening/candidate/{candidate.id}", headers=RECRUITER).json()


# ---------- handoff closes the loop ----------


def test_handoff_records_acknowledgement_and_notes(client, pipeline):
    job, candidate = pipeline
    handoff = client.post(
        "/api/handoff",
        json={
            "candidate_id": str(candidate.id),
            "candidate_name": candidate.name,
            "candidate_email": candidate.email,
            "job_id": str(job.id),
            "job_title": job.title,
            "interviewer_name": "Sam Interviewer",
            "interviewer_email": "sam@example.com",
            "recruiter_notes": "Probe rollout ownership.",
        },
        headers=RECRUITER,
    ).json()

    acknowledged = client.post(
        f"/api/handoff/{handoff['id']}/acknowledge",
        json={"interviewer_notes": "Read — will probe rollout."},
        headers=RECRUITER,
    ).json()

    assert acknowledged["status"] == "acknowledged"
    assert acknowledged["interviewer_notes"] == "Read — will probe rollout."


def test_handoff_moves_the_candidate_into_interviewing(client, pipeline):
    job, candidate = pipeline
    client.get(f"/api/candidates/rank?job_id={job.id}", headers=RECRUITER)
    client.post(
        "/api/handoff",
        json={
            "candidate_id": str(candidate.id),
            "candidate_name": candidate.name,
            "job_id": str(job.id),
            "job_title": job.title,
            "interviewer_name": "Sam Interviewer",
            "interviewer_email": "sam@example.com",
        },
        headers=RECRUITER,
    )

    assert stage_of(client, job, candidate) == "interviewing"


def test_unknown_handoff_is_404(client):
    assert client.get(f"/api/handoff/{uuid.uuid4()}", headers=RECRUITER).status_code == 404
