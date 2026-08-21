import pytest

from app.models.schemas import WeightConfig
from app.services import ats_benchmark_service
from app.services.candidate_matcher import CandidateMatcher


def test_compute_keyword_baseline_weights_required_over_nice_to_have(sample_candidate, sample_job):
    result = ats_benchmark_service.compute_keyword_baseline(sample_candidate, sample_job)
    # required: Python, SQL, Azure, Docker (all present) = 4*2 = 8
    # nice-to-have: Kubernetes (absent) = 0 of 1
    # weighted_total = 4*2 + 1 = 9 -> score = 8/9*100
    assert result["keyword_score"] == pytest.approx(88.89, abs=0.01)
    assert set(result["matched_keywords"]) == {"Python", "SQL", "Azure", "Docker"}
    assert result["missing_keywords"] == ["Kubernetes"]


def test_no_requirements_means_no_baseline_not_a_perfect_score(sample_candidate, sample_job):
    """A job with nothing to scan for has no keyword baseline at all.

    This previously returned 100.0, so every candidate got a flawless ATS
    score off zero matched keywords -- a confident-looking number backed by
    nothing. Absent is the honest answer.
    """
    sample_job.required_skills = []
    sample_job.nice_to_have_skills = []
    result = ats_benchmark_service.compute_keyword_baseline(sample_candidate, sample_job)
    assert result["keyword_score"] is None
    assert result["matched_keywords"] == []


def test_verdict_reports_a_missing_baseline_rather_than_comparing_to_it(sample_candidate, sample_job):
    assert ats_benchmark_service._verdict(None, 82.0) == "no_keyword_baseline"


def test_verdict_reports_an_unavailable_semantic_score(sample_candidate, sample_job):
    assert ats_benchmark_service._verdict(40.0, None) == "semantic_unavailable"


def test_verdict_still_compares_when_both_halves_exist():
    assert ats_benchmark_service._verdict(33.0, 82.0) == "semantic_stronger"
    assert ats_benchmark_service._verdict(82.0, 33.0) == "keyword_stronger"
    assert ats_benchmark_service._verdict(70.0, 75.0) == "aligned"


def test_ats_benchmark_404_before_evaluation_exists(client, sample_candidate, sample_job):
    response = client.post(
        f"/api/evaluation/{sample_candidate.id}/{sample_job.id}/ats-benchmark"
    )
    assert response.status_code == 404

    response = client.get(f"/api/evaluation/{sample_candidate.id}/{sample_job.id}/ats-benchmark")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_ats_benchmark_run_and_refetch(client, db, sample_candidate, sample_job):
    matcher = CandidateMatcher()
    await matcher.rank_candidates(db, sample_job.id, weight_config=WeightConfig(), persist=True)

    run = client.post(f"/api/evaluation/{sample_candidate.id}/{sample_job.id}/ats-benchmark")
    assert run.status_code == 200
    body = run.json()
    # Decimal fields serialize as JSON strings (pydantic v2 default) — cast for comparison.
    assert float(body["keyword_score"]) == pytest.approx(88.89, abs=0.01)
    assert float(body["semantic_score"]) == 78.0  # deterministic mock LLM response
    assert body["verdict"] == "aligned"
    benchmark_id = body["id"]

    fetched = client.get(f"/api/evaluation/{sample_candidate.id}/{sample_job.id}/ats-benchmark")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == benchmark_id

    # Re-running upserts the same row rather than creating a duplicate.
    rerun = client.post(f"/api/evaluation/{sample_candidate.id}/{sample_job.id}/ats-benchmark")
    assert rerun.status_code == 200
    assert rerun.json()["id"] == benchmark_id

    history = client.get(f"/api/handoff/history/{sample_candidate.id}")
    assert history.status_code == 200
    assert any(e["event_type"] == "ats_benchmark_computed" for e in history.json())


@pytest.mark.asyncio
async def test_delta_is_absent_when_the_model_returns_no_score(
    monkeypatch, sample_candidate, sample_job
):
    """A failed semantic call must not read as "the two scores agree".

    The old fallback copied the keyword baseline into the semantic slot, so
    the delta came out at exactly 0.00 and the verdict said "aligned" -- an
    agreement between one real score and a copy of itself.
    """
    monkeypatch.setattr(
        ats_benchmark_service.openai_service,
        "chat_json_or_empty",
        lambda *a, **k: {},  # model returned nothing usable
    )
    result = await ats_benchmark_service.get_benchmark(sample_candidate, sample_job)

    assert result["semantic_score"] is None
    assert result["score_delta"] is None
    assert result["verdict"] == "semantic_unavailable"
    # The keyword half is real and must survive.
    assert result["keyword_score"] == pytest.approx(88.89, abs=0.01)


@pytest.mark.asyncio
async def test_delta_is_absent_when_the_job_lists_no_skills(
    monkeypatch, sample_candidate, sample_job
):
    monkeypatch.setattr(
        ats_benchmark_service.openai_service,
        "chat_json_or_empty",
        lambda *a, **k: {"semantic_score": 82, "rationale": "solid", "equivalent_terms": []},
    )
    sample_job.required_skills = []
    sample_job.nice_to_have_skills = []
    result = await ats_benchmark_service.get_benchmark(sample_candidate, sample_job)

    assert result["keyword_score"] is None
    assert result["score_delta"] is None
    assert result["verdict"] == "no_keyword_baseline"
    assert result["semantic_score"] == 82.0  # the half that exists still reports


# --- keyword matching accuracy ------------------------------------------------


def test_a_skill_hiding_inside_a_longer_word_is_not_a_match():
    """The matcher fell back to a bare substring check, so "react" satisfied
    a requirement for "R", "django" satisfied "Go", "javascript" satisfied
    "Java" and "cloud" satisfied "C" — inflating the baseline for résumés
    that never mentioned the skill."""
    resume = "built django services, a react frontend, javascript tooling, google cloud"

    for skill in ("R", "Go", "Java", "C"):
        assert not ats_benchmark_service._keyword_present(skill, resume), skill


def test_the_skills_that_are_really_there_still_match():
    resume = "built django services, a react frontend, javascript tooling"

    for skill in ("React", "Django", "JavaScript"):
        assert ats_benchmark_service._keyword_present(skill, resume), skill


def test_punctuated_skill_names_match():
    resume = "c++ modules, c# services, asp.net legacy, node.js apis"

    for skill in ("C++", "C#", ".NET", "Node.js"):
        assert ats_benchmark_service._keyword_present(skill, resume), skill


def test_separator_spelling_matches_in_both_directions():
    assert ats_benchmark_service._keyword_present("NodeJS", "built node.js apis")
    assert ats_benchmark_service._keyword_present("Node.js", "built nodejs apis")


def test_c_is_not_satisfied_by_cpp_or_csharp():
    """Different languages that merely share a prefix."""
    assert not ats_benchmark_service._keyword_present("C", "c++ and c# work")
    assert ats_benchmark_service._keyword_present("C", "wrote c and assembly")


def test_missing_required_is_reported_apart_from_nice_to_have(sample_candidate, sample_job):
    sample_job.required_skills = ["Python", "Kubernetes"]
    sample_job.nice_to_have_skills = ["Terraform"]

    result = ats_benchmark_service.compute_keyword_baseline(sample_candidate, sample_job)

    # The weighted score alone cannot say whether a must-have is the gap.
    assert "Kubernetes" in result["missing_required"]
    assert "Kubernetes" not in result["missing_nice_to_have"]
    assert result["meets_required"] is False
    assert result["required_coverage_pct"] == 50.0


def test_meeting_every_required_skill_is_reported(sample_candidate, sample_job):
    sample_job.required_skills = ["Python"]
    sample_job.nice_to_have_skills = ["Kubernetes"]

    result = ats_benchmark_service.compute_keyword_baseline(sample_candidate, sample_job)

    assert result["missing_required"] == []
    assert result["meets_required"] is True
    assert result["required_coverage_pct"] == 100.0
