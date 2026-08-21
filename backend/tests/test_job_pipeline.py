import uuid

import pytest

from app.models.candidate import Candidate
from app.models.schemas import WeightConfig
from app.services.candidate_matcher import CandidateMatcher


@pytest.fixture()
def internal_candidate(store):
    candidate = Candidate(
        owner_email="recruiter@example.com",
        id=uuid.uuid4(),
        name="Priya Nair",
        email="priya.nair@example.com",
        resume_text="Priya Nair. Skills: Python, SQL, Azure, Docker. Internal transfer candidate.",
        skills=["Python", "SQL", "Azure", "Docker"],
        experience=[{"company": "Internal", "title": "Engineer", "years": 3}],
        education=[{"school": "State U", "degree": "BSc"}],
        source="internal",
    )
    store.candidates.save(candidate)
    return candidate


@pytest.mark.asyncio
async def test_job_pipeline_counts_internal_vs_external_and_stages(
    client, db, sample_candidate, sample_job, internal_candidate
):
    matcher = CandidateMatcher()
    await matcher.rank_candidates(db, sample_job.id, weight_config=WeightConfig(), persist=True)

    # Reject the external (sample_candidate) via the decision endpoint.
    reject = client.post(
        "/api/candidates/decision",
        json={
            "candidate_id": str(sample_candidate.id),
            "name": sample_candidate.name,
            "email": sample_candidate.email,
            "decision": "rejected",
            "job_title": sample_job.title,
        },
    )
    assert reject.status_code == 200

    # Hand off a briefing for the internal candidate.
    handoff = client.post(
        "/api/handoff",
        json={
            "candidate_id": str(internal_candidate.id),
            "candidate_name": internal_candidate.name,
            "job_id": str(sample_job.id),
            "job_title": sample_job.title,
            "interviewer_name": "Sam Lee",
            "interviewer_email": "sam.lee@example.com",
        },
    )
    assert handoff.status_code == 200

    summaries = client.get("/api/dashboard/jobs")
    assert summaries.status_code == 200
    job_summary = next(s for s in summaries.json() if s["job_id"] == str(sample_job.id))
    assert job_summary["total_candidates"] == 2
    assert job_summary["internal_candidates"] == 1
    assert job_summary["external_candidates"] == 1
    assert job_summary["stage_counts"]["rejected"] == 1
    assert job_summary["stage_counts"]["interviewing"] == 1

    pipeline = client.get(f"/api/dashboard/jobs/{sample_job.id}/pipeline")
    assert pipeline.status_code == 200
    rows = {r["candidate_id"]: r for r in pipeline.json()}
    assert rows[str(sample_candidate.id)]["stage"] == "rejected"
    assert rows[str(internal_candidate.id)]["stage"] == "interviewing"
    assert rows[str(internal_candidate.id)]["source"] == "internal"

    internal_only = client.get(
        f"/api/dashboard/jobs/{sample_job.id}/pipeline", params={"source": "internal"}
    )
    assert internal_only.status_code == 200
    assert len(internal_only.json()) == 1
    assert internal_only.json()[0]["candidate_id"] == str(internal_candidate.id)


def test_update_candidate_source(client, sample_candidate):
    response = client.put(
        f"/api/candidates/{sample_candidate.id}",
        json={"source": "internal"},
    )
    assert response.status_code == 200
    assert response.json()["source"] == "internal"


def test_update_candidate_source_rejects_invalid_value(client, sample_candidate):
    response = client.put(
        f"/api/candidates/{sample_candidate.id}",
        json={"source": "contractor"},
    )
    assert response.status_code == 422


def test_dashboard_jobs_pipeline_404_for_unknown_job(client):
    response = client.get(f"/api/dashboard/jobs/{uuid.uuid4()}/pipeline")
    assert response.status_code == 404
