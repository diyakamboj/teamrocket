import uuid

import pytest

from app.models.candidate import Candidate
from app.models.schemas import AgentEvaluationSummary
from app.services import internal_marketplace_service
from app.services.candidate_matcher import CandidateMatcher, bench_sort_key


@pytest.fixture()
def bench_candidate(store):
    candidate = Candidate(
        owner_email="recruiter@example.com",
        id=uuid.uuid4(),
        name="Bench Priya",
        email="bench.priya@example.com",
        resume_text="Bench Priya. Skills: Python, SQL, Azure, Docker. On the bench, available now.",
        skills=["Python", "SQL", "Azure", "Docker"],
        experience=[{"company": "Internal", "title": "Engineer", "years": 3}],
        education=[{"school": "State U", "degree": "BSc", "field": "Computer Science"}],
        certifications=["AZ-900"],
        projects=[{"name": "Internal Tool", "description": "FastAPI service", "technologies": ["Python"]}],
        source="internal",
        employment_status="bench",
    )
    store.candidates.save(candidate)
    return candidate


@pytest.fixture()
def external_candidate(store):
    candidate = Candidate(
        owner_email="recruiter@example.com",
        id=uuid.uuid4(),
        name="External Erin",
        email="external.erin@example.com",
        resume_text="External Erin. Skills: Python, SQL. External applicant.",
        skills=["Python", "SQL"],
        experience=[{"company": "Other Co", "title": "Engineer", "years": 4}],
        education=[{"school": "Other U", "degree": "BSc"}],
        source="external",
    )
    store.candidates.save(candidate)
    return candidate


def test_bench_sort_key_ordering():
    bench = bench_sort_key(70, "bench", "Bench")  # boosts to 78 for ordering
    non_bench_lower = bench_sort_key(76, None, "NonBenchLower")
    non_bench_higher = bench_sort_key(90, None, "NonBenchHigher")

    ordered = sorted(
        [
            ("non_bench_higher", non_bench_higher),
            ("non_bench_lower", non_bench_lower),
            ("bench", bench),
        ],
        key=lambda pair: pair[1],
    )
    order = [name for name, _ in ordered]

    # Bench@70 (boosted to 78) beats non-bench@76 but loses to non-bench@90.
    assert order == ["non_bench_higher", "bench", "non_bench_lower"]


@pytest.mark.asyncio
async def test_rank_candidates_source_filter_excludes_external(
    db, sample_job, bench_candidate, external_candidate
):
    matcher = CandidateMatcher()
    ranked = await matcher.rank_candidates(db, sample_job.id, persist=False, source="internal")

    names = {item["name"] for item in ranked}
    assert names == {"Bench Priya"}
    assert "External Erin" not in names


@pytest.mark.asyncio
async def test_rank_candidates_bench_priority_reorders(db, sample_job, monkeypatch):
    # Three candidates persisted so rank_candidates has something to iterate,
    # but score_candidate is patched to return fixed scores so the
    # bench-priority reordering can be asserted deterministically without
    # depending on the (deterministic-but-opaque) mock-mode scoring math.
    bench = Candidate(
        owner_email="recruiter@example.com",
        id=uuid.uuid4(),
        name="Bench Candidate",
        email="bench.candidate@example.com",
        source="internal",
        employment_status="bench",
    )
    non_bench_close = Candidate(
        owner_email="recruiter@example.com",
        id=uuid.uuid4(),
        name="Close Non-Bench Candidate",
        email="close.nonbench@example.com",
        source="internal",
    )
    non_bench_high = Candidate(
        owner_email="recruiter@example.com",
        id=uuid.uuid4(),
        name="High Non-Bench Candidate",
        email="high.nonbench@example.com",
        source="internal",
    )
    for c in (bench, non_bench_close, non_bench_high):
        db.candidates.save(c)

    fixed_scores = {
        bench.id: 70.0,
        non_bench_close.id: 76.0,
        non_bench_high.id: 90.0,
    }

    async def fake_score_candidate(self, candidate, job, weights):
        return {
            "candidate_id": candidate.id,
            "name": candidate.name,
            "email": candidate.email,
            "overall_score": fixed_scores[candidate.id],
            "skill_score": fixed_scores[candidate.id],
            "experience_score": fixed_scores[candidate.id],
            "education_score": fixed_scores[candidate.id],
            "certification_score": fixed_scores[candidate.id],
            "project_score": fixed_scores[candidate.id],
            "matched_skills": [],
            "missing_skills": [],
            "strengths": None,
            "weaknesses": None,
            "transferable_skills": None,
            "evidence": [],
            "source": candidate.source,
            "employment_status": candidate.employment_status,
            "current_assignment": candidate.current_assignment,
        }

    monkeypatch.setattr(CandidateMatcher, "score_candidate", fake_score_candidate)

    matcher = CandidateMatcher()
    ranked = await matcher.rank_candidates(
        db, sample_job.id, persist=False, source="internal", bench_priority=True
    )

    ordered_names = [item["name"] for item in ranked]
    assert ordered_names == [
        "High Non-Bench Candidate",  # 90, untouched by boost
        "Bench Candidate",  # 70 + 8 boost = 78 for ordering purposes only
        "Close Non-Bench Candidate",  # 76, no boost
    ]

    bench_result = next(item for item in ranked if item["candidate_id"] == bench.id)
    assert bench_result["overall_score"] == 70.0  # never mutated by the boost


@pytest.mark.asyncio
async def test_internal_marketplace_get_internal_matches_returns_verdicts(
    db, sample_job, bench_candidate, external_candidate
):
    results = await internal_marketplace_service.get_internal_matches(
        db, sample_job.id, bench_priority=True, persist=False
    )

    assert isinstance(results, list)
    assert len(results) == 1  # external candidate excluded
    summary = results[0]
    assert isinstance(summary, AgentEvaluationSummary)
    assert summary.candidate.source == "internal"
    assert summary.candidate.employment_status == "bench"
    assert len(summary.verdicts) > 0


def test_update_candidate_rejects_invalid_employment_status(client, bench_candidate):
    response = client.put(
        f"/api/candidates/{bench_candidate.id}",
        json={"employment_status": "on_vacation"},
    )
    assert response.status_code == 422

    valid = client.put(
        f"/api/candidates/{bench_candidate.id}",
        json={"employment_status": "assigned"},
    )
    assert valid.status_code == 200
    assert valid.json()["employment_status"] == "assigned"
