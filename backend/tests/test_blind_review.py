import uuid

import pytest

from app.models.candidate import Candidate
from app.services.candidate_comparison import candidate_comparison
from app.services.candidate_matcher import CandidateMatcher
from app.services.recruiter_agent import recruiter_agent


@pytest.fixture()
def second_candidate(store):
    candidate = Candidate(
        owner_email="recruiter@example.com",
        id=uuid.uuid4(),
        name="Bob Martinez",
        email="bob.martinez@example.com",
        resume_text="Bob Martinez. Skills: Python, SQL, Azure. Built data pipelines for 5 years.",
        skills=["Python", "SQL", "Azure"],
        experience=[{"company": "Acme", "title": "Engineer", "years": 5}],
        education=[{"school": "Tech U", "degree": "BSc"}],
    )
    store.candidates.save(candidate)
    return candidate


@pytest.mark.asyncio
async def test_get_candidate_score_redacts_identity_when_blind(db, sample_candidate, sample_job):
    matcher = CandidateMatcher()
    score = await matcher.get_candidate_score(
        db, sample_candidate.id, sample_job.id, persist=True, blind_mode=True
    )
    assert score["name"] != sample_candidate.name
    assert score["name"].startswith("Candidate-")
    assert score["email"] is None
    assert sample_candidate.name not in str(score)
    assert sample_candidate.email not in str(score)


@pytest.mark.asyncio
async def test_get_candidate_score_reveals_identity_when_not_blind(db, sample_candidate, sample_job):
    matcher = CandidateMatcher()
    score = await matcher.get_candidate_score(
        db, sample_candidate.id, sample_job.id, persist=True, blind_mode=False
    )
    assert score["name"] == sample_candidate.name
    assert score["email"] == sample_candidate.email


@pytest.mark.asyncio
async def test_candidate_comparison_redacts_identity_when_blind(
    db, sample_candidate, sample_job, second_candidate
):
    result = await candidate_comparison.compare(
        db, sample_job.id, [sample_candidate.id, second_candidate.id], blind_mode=True
    )
    names = {c["name"] for c in result["candidates"]}
    assert sample_candidate.name not in names
    assert second_candidate.name not in names
    assert all(n.startswith("Candidate-") for n in names)
    # The real names must not leak into the LLM prompt inputs either.
    assert sample_candidate.name not in str(result["candidates"])
    assert second_candidate.name not in str(result["candidates"])


def test_compare_endpoint_blind_mode(client, db, sample_candidate, sample_job, second_candidate):
    response = client.post(
        "/api/evaluation/compare",
        json={
            "job_id": str(sample_job.id),
            "candidate_ids": [str(sample_candidate.id), str(second_candidate.id)],
            "blind_mode": True,
        },
    )
    assert response.status_code == 200
    body = response.json()
    names = {c["name"] for c in body["candidates"]}
    assert sample_candidate.name not in names
    assert second_candidate.name not in names
    for c in body["candidates"]:
        assert c["email"] is None


def test_build_context_hides_names_and_adds_identity_instruction(sample_job):
    blinded_ranked = [
        {"candidate_id": "x", "name": "Candidate-abcd1234", "email": None, "overall_score": 90}
    ]
    context = recruiter_agent._build_context(
        sample_job, blinded_ranked, blinded_ranked, "Who is the best fit?", blind_mode=True
    )
    assert "Candidate-abcd1234" in context
    assert "Blind review is ON" in context
    assert "Alice Johnson" not in context  # sanity: no real name ever passed in


@pytest.mark.asyncio
async def test_agent_ask_endpoint_accepts_blind_mode(client, sample_job):
    response = client.post(
        "/api/agent/ask",
        json={"query": "Who should I interview first?", "job_id": str(sample_job.id), "blind_mode": True},
    )
    assert response.status_code == 200
    assert isinstance(response.json()["response"], str)
