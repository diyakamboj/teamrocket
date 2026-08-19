"""End-to-end: two recruiters working one candidate through a job's loop.

Exercises the whole path the UI takes — connect, share to collaborate, move
through the rounds, and read the board back — so the pieces are checked
together rather than only in isolation.
"""

import uuid

import pytest

from app.models.candidate import Candidate
from app.models.connection import RecruiterConnection
from app.models.job_posting import InterviewRound, JobPosting
from app.models.user import User

OWNER = "recruiter@example.com"
PEER = "peer@example.com"


@pytest.fixture()
def workspace(store):
    for email, name in ((OWNER, "Owner One"), (PEER, "Peer Two")):
        store.users.save(
            User(email=email, name=name, password_hash="x", password_salt="y")
        )
    store.recruiter_connections.save(
        RecruiterConnection(requester_email=OWNER, addressee_email=PEER, status="accepted")
    )
    job = JobPosting(
        id=uuid.uuid4(),
        title="Backend Engineer",
        description="Build APIs.",
        created_by=OWNER,
        rounds=[
            InterviewRound(id="r1", name="Recruiter screen", sequence=1),
            InterviewRound(id="r2", name="Technical interview", sequence=2),
            InterviewRound(id="r3", name="Hiring manager", sequence=3),
        ],
    )
    store.jobs.save(job)
    candidate = Candidate(
        id=uuid.uuid4(),
        owner_email=OWNER,
        name="Alice Johnson",
        email="alice.johnson@example.com",
        resume_text="Python, SQL.",
        skills=["Python"],
    )
    store.candidates.save(candidate)
    return job, candidate


def _board(client, job, actor=OWNER):
    response = client.get(
        f"/api/dashboard/jobs/{job.id}/pipeline",
        headers={"X-Recruiter-Email": actor},
    )
    assert response.status_code == 200
    return {row["candidate_id"]: row for row in response.json()}


def test_two_recruiters_move_one_candidate_through_the_loop(client, workspace):
    job, candidate = workspace

    # The owner shares the candidate to collaborate on.
    share = client.post(
        "/api/connections/share",
        json={
            "candidate_id": str(candidate.id),
            "email": PEER,
            "job_id": str(job.id),
            "permission": "collaborate",
            "note": "Want your read on the system design round.",
        },
        headers={"X-Recruiter-Email": OWNER},
    )
    assert share.status_code == 201

    # The owner starts them in the first round.
    client.put(
        f"/api/dashboard/jobs/{job.id}/pipeline/{candidate.id}",
        json={"stage": "interviewing"},
        headers={"X-Recruiter-Email": OWNER},
    )
    row = _board(client, job)[str(candidate.id)]
    assert (row["stage"], row["round_name"]) == ("interviewing", "Recruiter screen")

    # The collaborator advances them to the last round...
    advanced = client.put(
        f"/api/dashboard/jobs/{job.id}/pipeline/{candidate.id}",
        json={"stage": "interviewing", "round_id": "r3"},
        headers={"X-Recruiter-Email": PEER},
    )
    assert advanced.status_code == 200
    assert advanced.json()["round_name"] == "Hiring manager"

    # ...leaves a note the owner can read...
    client.post(
        f"/api/connections/candidates/{candidate.id}/notes",
        json={"body": "Strong design round. I'd hire.", "job_id": str(job.id)},
        headers={"X-Recruiter-Email": PEER},
    )
    notes = client.get(
        f"/api/connections/candidates/{candidate.id}/notes",
        headers={"X-Recruiter-Email": OWNER},
    ).json()
    assert [n["author_name"] for n in notes] == ["Peer Two"]

    # ...and the owner hires them, which clears the round.
    hired = client.put(
        f"/api/dashboard/jobs/{job.id}/pipeline/{candidate.id}",
        json={"stage": "hired"},
        headers={"X-Recruiter-Email": OWNER},
    )
    assert hired.json()["stage"] == "hired"
    assert hired.json()["round_id"] is None

    final = _board(client, job)[str(candidate.id)]
    assert final["stage"] == "hired"
    assert final["moved_by"] == OWNER

    # The dashboard counts the hire instead of raising on it.
    summary = client.get("/api/dashboard/jobs", headers={"X-Recruiter-Email": OWNER}).json()
    mine = next(s for s in summary if s["job_id"] == str(job.id))
    assert mine["stage_counts"]["hired"] == 1


def test_revoking_a_share_ends_the_collaboration(client, workspace):
    job, candidate = workspace
    share_id = client.post(
        "/api/connections/share",
        json={
            "candidate_id": str(candidate.id),
            "email": PEER,
            "permission": "collaborate",
        },
        headers={"X-Recruiter-Email": OWNER},
    ).json()["share_id"]

    client.delete(
        f"/api/connections/share/{share_id}", headers={"X-Recruiter-Email": OWNER}
    )

    blocked = client.put(
        f"/api/dashboard/jobs/{job.id}/pipeline/{candidate.id}",
        json={"stage": "hired"},
        headers={"X-Recruiter-Email": PEER},
    )
    assert blocked.status_code == 403


def test_share_carries_the_pipeline_so_a_collaborator_can_act(client, workspace):
    """A collaborator cannot list the owner's jobs, so the share itself has to
    tell them where the candidate stands and what rounds exist."""
    job, candidate = workspace
    client.post(
        "/api/connections/share",
        json={
            "candidate_id": str(candidate.id),
            "email": PEER,
            "job_id": str(job.id),
            "permission": "collaborate",
        },
        headers={"X-Recruiter-Email": OWNER},
    )
    client.put(
        f"/api/dashboard/jobs/{job.id}/pipeline/{candidate.id}",
        json={"stage": "interviewing", "round_id": "r2"},
        headers={"X-Recruiter-Email": OWNER},
    )

    # The owner's jobs stay invisible to them...
    assert client.get("/api/jobs", headers={"X-Recruiter-Email": PEER}).json() == []

    # ...but the share tells them where the candidate is and where they can go.
    shared = client.get(
        "/api/connections/shared-with-me", headers={"X-Recruiter-Email": PEER}
    ).json()[0]
    assert shared["stage"] == "interviewing"
    assert shared["round_name"] == "Technical interview"
    assert [r["name"] for r in shared["rounds"]] == [
        "Recruiter screen",
        "Technical interview",
        "Hiring manager",
    ]


def test_a_view_only_share_still_shows_the_stage(client, workspace):
    job, candidate = workspace
    client.post(
        "/api/connections/share",
        json={
            "candidate_id": str(candidate.id),
            "email": PEER,
            "job_id": str(job.id),
            "permission": "view",
        },
        headers={"X-Recruiter-Email": OWNER},
    )

    shared = client.get(
        "/api/connections/shared-with-me", headers={"X-Recruiter-Email": PEER}
    ).json()[0]

    # Nobody has moved them, so they read as screened rather than blank.
    assert shared["stage"] == "screened"
    assert shared["permission"] == "view"


def test_a_share_without_a_job_has_no_pipeline(client, workspace):
    _, candidate = workspace
    client.post(
        "/api/connections/share",
        json={"candidate_id": str(candidate.id), "email": PEER, "permission": "collaborate"},
        headers={"X-Recruiter-Email": OWNER},
    )

    shared = client.get(
        "/api/connections/shared-with-me", headers={"X-Recruiter-Email": PEER}
    ).json()[0]

    assert shared["stage"] is None
    assert shared["rounds"] == []
