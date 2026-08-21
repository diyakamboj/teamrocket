import uuid

import pytest

from app.models.candidate import Candidate
from app.models.evaluation import Evaluation
from app.models.handoff import InterviewHandoff
from app.models.job_posting import JobPosting
from app.services.candidate_matcher import CandidateMatcher
from app.services.copilot_agent import copilot_answer, is_analytics_query
from app.services.jd_optimizer import jd_optimizer
from app.services.recruiter_agent import RecruiterCopilot
from app.utils.validators import has_normalized_skill, normalized_skill_set


def _add_candidate(store, *, name, email, skills, source="external"):
    candidate = Candidate(
        owner_email="recruiter@example.com",
        id=uuid.uuid4(),
        name=name,
        email=email,
        skills=skills,
        resume_text=f"{name} skills: {', '.join(skills)}",
        source=source,
        experience=[{"company": "Acme", "title": "Engineer", "years": 4}],
    )
    store.candidates.save(candidate)
    return candidate


def _add_evaluated_candidate(
    store,
    job_id,
    *,
    name,
    email,
    skills,
    overall_score=80,
    interviewing=False,
    source="external",
    job_title="Platform Engineer",
):
    candidate = _add_candidate(store, name=name, email=email, skills=skills, source=source)
    evaluation = Evaluation(
        candidate_id=candidate.id,
        job_id=job_id,
        overall_score=overall_score,
        skill_match_score=80,
        experience_match_score=75,
        education_match_score=70,
        certification_match_score=60,
        project_match_score=50,
        matched_skills=skills,
        missing_skills=[],
    )
    store.evaluations.save(evaluation)
    if interviewing:
        store.handoffs.save(
            InterviewHandoff(
                candidate_id=str(candidate.id),
                candidate_name=candidate.name,
                candidate_email=candidate.email,
                job_id=str(job_id),
                job_title=job_title,
                interviewer_name="Sam Lee",
                interviewer_email="sam.lee@example.com",
                status="pending",
            )
        )
    return candidate, evaluation


def _platform_job(store) -> JobPosting:
    job = JobPosting(
        id=uuid.uuid4(),
        title="Platform Engineer",
        description="Need Kubernetes, Python, Docker and Terraform",
        required_skills=["Kubernetes", "Python", "Docker", "SQL"],
        nice_to_have_skills=["Terraform"],
        created_by="recruiter@example.com",
    )
    store.jobs.save(job)
    return job


def _seed_platform_pool(store, job_id):
    """10 evaluated candidates with hand-computed coverage:

    Kubernetes 2/10 = 20%  (MUST → too_strict)
    Python      9/10 = 90%  (MUST → low_signal)
    Docker     10/10 = 100% (MUST → low_signal)
    SQL         5/10 = 50%  (MUST → balanced)
    Terraform   1/10 = 10%  (nice → under_filtered)
    """
    for index in range(10):
        skills = ["Docker"]
        if index < 9:
            skills.append("Python")
        if index < 2:
            skills.append("Kubernetes")
        if index < 5:
            skills.append("SQL")
        if index == 0:
            skills.append("Terraform")
        _add_evaluated_candidate(
            store,
            job_id,
            name=f"Candidate {index}",
            email=f"candidate{index}@example.com",
            skills=skills,
            overall_score=40 if index >= 6 else 80,
            interviewing=index == 0,
            source="internal" if index == 0 else "external",
        )


def test_jd_optimization_returns_insufficient_data_for_small_pool(client, db):
    job = JobPosting(
        id=uuid.uuid4(),
        title="Backend Engineer",
        description="Need Python, Docker, Kubernetes",
        required_skills=["Python", "Docker"],
        nice_to_have_skills=["Kubernetes"],
        created_by="recruiter@example.com",
    )
    db.jobs.save(job)

    _add_evaluated_candidate(
        db,
        job.id,
        name="Alice",
        email="alice@example.com",
        skills=["Python", "Docker"],
        job_title=job.title,
    )

    response = client.get(f"/api/dashboard/job/{job.id}/jd-optimization")
    assert response.status_code == 200
    payload = response.json()
    assert payload["job_title"] == "Backend Engineer"
    assert payload["recommendations"][0]["classification"] == "insufficient_data"
    assert payload["recommendations"][0]["status"] == "pending"
    assert payload["recommendations"][0]["id"]


def test_jd_optimization_classifies_strict_lenient_and_balanced(client, db):
    job = _platform_job(db)
    _seed_platform_pool(db, job.id)

    response = client.get(f"/api/dashboard/job/{job.id}/jd-optimization")
    assert response.status_code == 200
    payload = response.json()

    by_skill = {item["skill"]: item for item in payload["recommendations"]}
    assert by_skill["Kubernetes"]["classification"] == "too_strict"
    assert by_skill["Kubernetes"]["coverage_pct"] == 20.0
    assert by_skill["Kubernetes"]["candidates_matching"] == 2
    assert by_skill["Kubernetes"]["total_candidates"] == 10
    assert by_skill["Kubernetes"]["suggested_modification"] == "Move to nice-to-have"

    assert by_skill["Python"]["classification"] == "low_signal"
    assert by_skill["Python"]["coverage_pct"] == 90.0

    assert by_skill["Docker"]["classification"] == "low_signal"
    assert by_skill["Docker"]["coverage_pct"] == 100.0

    assert by_skill["SQL"]["classification"] == "balanced"
    assert by_skill["SQL"]["coverage_pct"] == 50.0

    assert by_skill["Terraform"]["classification"] == "under_filtered"
    assert by_skill["Terraform"]["coverage_pct"] == 10.0
    assert by_skill["Terraform"]["candidates_matching"] == 1


def test_coverage_agrees_with_candidate_matcher_normalization(db):
    job = _platform_job(db)
    _seed_platform_pool(db, job.id)
    evaluations = db.evaluations.list_for_job(job.id)
    candidates = {evaluation.candidate_id: db.candidates.get(evaluation.candidate_id) for evaluation in evaluations}

    matcher_matches = 0
    optimizer_matches = 0
    for evaluation in evaluations:
        candidate = candidates[evaluation.candidate_id]
        cand_skills = [str(s) for s in (candidate.skills or [])]
        if CandidateMatcher._jaccard(cand_skills, ["Kubernetes"]) == 100.0:
            matcher_matches += 1
        if has_normalized_skill("Kubernetes", normalized_skill_set(candidate.skills)):
            optimizer_matches += 1
    assert matcher_matches == optimizer_matches == 2


def test_hiring_insights_scopes_to_evaluated_candidates(client, db):
    job = _platform_job(db)
    _seed_platform_pool(db, job.id)
    # Unevaluated candidate must not inflate skill / experience aggregates.
    _add_candidate(
        db,
        name="Out of scope",
        email="outsider@example.com",
        skills=["Kubernetes", "Rust", "Go"],
    )

    response = client.get(f"/api/dashboard/job/{job.id}/insights")
    assert response.status_code == 200
    payload = response.json()
    assert payload["evaluated_candidates"] == 10
    assert payload["total_candidates"] == 10
    rust = next((row for row in payload["top_skills"] if row["skill"] == "Rust"), None)
    assert rust is None
    assert payload["pipeline_progression"]["screened"] == 9
    assert payload["pipeline_progression"]["interviewing"] == 1
    assert payload["candidate_sources"]["external"] == 9
    assert payload["candidate_sources"]["internal"] == 1
    assert payload["jd_suggestions_count"] == 5
    assert payload["jd_top_flag"] == "too_strict"

    kube = next(row for row in payload["skill_coverage"] if row["skill"] == "Kubernetes")
    # 8 missing Kubernetes; indexes 6-9 score 40 (4 of those 8 are low-score without skill).
    assert kube["coverage_pct"] == 20.0
    assert kube["low_score_without_skill_pct"] == 40.0


def test_distribution_is_job_scoped(client, db):
    job = _platform_job(db)
    _seed_platform_pool(db, job.id)
    _add_candidate(
        db,
        name="Out of scope",
        email="outsider2@example.com",
        skills=["Rust"],
        source="internal",
    )

    response = client.get(f"/api/dashboard/job/{job.id}/distribution")
    assert response.status_code == 200
    payload = response.json()
    assert payload["experience_levels"]["Mid"] == 10
    assert payload["candidate_sources"]["internal"] == 1
    assert payload["pipeline_progression"]["screened"] == 9


def test_recommendation_status_survives_regeneration(client, db):
    job = _platform_job(db)
    _seed_platform_pool(db, job.id)

    first = client.get(f"/api/dashboard/job/{job.id}/jd-optimization").json()
    kube = next(item for item in first["recommendations"] if item["skill"] == "Kubernetes")
    decision = client.post(
        f"/api/dashboard/job/{job.id}/jd-optimization/{kube['id']}/decision",
        json={"status": "rejected", "note": "Keep as MUST-have for now"},
    )
    assert decision.status_code == 200
    assert decision.json()["status"] == "rejected"

    _add_evaluated_candidate(
        db,
        job.id,
        name="Late arrival",
        email="late@example.com",
        skills=["Docker", "Python"],
        job_title=job.title,
    )

    second = client.get(f"/api/dashboard/job/{job.id}/jd-optimization").json()
    kube_again = next(item for item in second["recommendations"] if item["skill"] == "Kubernetes")
    assert kube_again["id"] == kube["id"]
    assert kube_again["status"] == "rejected"
    assert kube_again["recruiter_note"] == "Keep as MUST-have for now"
    assert kube_again["total_candidates"] == 11


def test_empty_states(client, db):
    job = JobPosting(
        id=uuid.uuid4(),
        title="Empty Role",
        description="No skills extracted",
        required_skills=[],
        nice_to_have_skills=[],
        created_by="recruiter@example.com",
    )
    db.jobs.save(job)

    no_skills = client.get(f"/api/dashboard/job/{job.id}/jd-optimization").json()
    assert no_skills["recommendations"] == []
    assert no_skills["empty_reason"] == "no_required_skills"

    job.required_skills = ["Python"]
    db.jobs.save(job)
    no_evals = client.get(f"/api/dashboard/job/{job.id}/jd-optimization").json()
    assert no_evals["empty_reason"] == "no_evaluations"


def test_extract_analytics_query_detects_intent():
    agent = RecruiterCopilot()
    assert agent._extract_analytics_query("Which JD requirements are eliminating the most candidates?")
    assert agent._extract_analytics_query("What % of candidates have Kubernetes?")
    assert agent._extract_analytics_query("Show me skill gaps and drop-off")
    assert is_analytics_query("Which JD requirements are eliminating the most candidates?")
    assert not agent._extract_analytics_query("Compare Alice and Bob")
    assert not agent._extract_analytics_query("Who is the strongest overall fit?")


@pytest.mark.asyncio
async def test_copilot_grounds_jd_calibration(db):
    job = _platform_job(db)
    _seed_platform_pool(db, job.id)

    result = await copilot_answer(
        db=db,
        job=job,
        question="Which JD requirements are eliminating the most candidates?",
    )
    assert result["tools"] == ["jd_calibration"]
    assert "Kubernetes" in result["answer"]
    assert "20" in result["answer"]

    payload = await jd_optimizer.get_optimization(db, job.id)
    assert payload["recommendations"][0]["skill"] == "Kubernetes"
