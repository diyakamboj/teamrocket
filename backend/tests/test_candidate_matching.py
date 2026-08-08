import pytest

from app.models.schemas import WeightConfig
from app.services.candidate_matcher import CandidateMatcher


@pytest.mark.asyncio
async def test_score_candidate_high_skill_overlap(sample_candidate, sample_job):
    matcher = CandidateMatcher()
    score = await matcher.score_candidate(
        sample_candidate, sample_job, WeightConfig()
    )
    assert score["overall_score"] >= 70
    assert score["skill_score"] >= 80
    assert "Python" in str(score["matched_skills"])


@pytest.mark.asyncio
async def test_rank_candidates_assigns_ranks(db, sample_candidate, sample_job):
    matcher = CandidateMatcher()
    ranked = await matcher.rank_candidates(db, sample_job.id, persist=True)
    assert len(ranked) == 1
    assert ranked[0]["rank"] == 1
    assert ranked[0]["candidate_id"] == sample_candidate.id
    assert ranked[0]["evaluation_id"] is not None
