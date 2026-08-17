import uuid

from app.models.candidate import Candidate
from app.models.evaluation import Evaluation
from app.models.job_posting import JobPosting


def _add_evaluated_candidate(db, job_id, *, name, email, skills):
    candidate = Candidate(
        id=uuid.uuid4(),
        name=name,
        email=email,
        skills=skills,
        resume_text=f"{name} skills: {', '.join(skills)}",
    )
    db.add(candidate)
    db.commit()
    db.refresh(candidate)

    evaluation = Evaluation(
        candidate_id=candidate.id,
        job_id=job_id,
        overall_score=80,
        skill_match_score=80,
        experience_match_score=75,
        education_match_score=70,
        certification_match_score=60,
        project_match_score=50,
        matched_skills=skills,
        missing_skills=[],
    )
    db.add(evaluation)
    db.commit()
    db.refresh(evaluation)
    return candidate, evaluation


def test_jd_optimization_returns_insufficient_data_for_small_pool(client, db):
    job = JobPosting(
        id=uuid.uuid4(),
        title="Backend Engineer",
        description="Need Python, Docker, Kubernetes",
        required_skills=["Python", "Docker"],
        nice_to_have_skills=["Kubernetes"],
        created_by="recruiter@example.com",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    _add_evaluated_candidate(
        db,
        job.id,
        name="Alice",
        email="alice@example.com",
        skills=["Python", "Docker"],
    )

    response = client.get(f"/api/dashboard/job/{job.id}/jd-optimization")
    assert response.status_code == 200
    payload = response.json()
    assert payload["job_title"] == "Backend Engineer"
    assert payload["suggestions"][0]["classification"] == "insufficient_data"


def test_jd_optimization_classifies_strict_lenient_and_balanced(client, db):
    job = JobPosting(
        id=uuid.uuid4(),
        title="Platform Engineer",
        description="Need Kubernetes, Python, Docker and Terraform",
        required_skills=["Kubernetes", "Python", "Docker"],
        nice_to_have_skills=["Terraform"],
        created_by="recruiter@example.com",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    for index in range(10):
        skills = ["Docker"]
        if index < 9:
            skills.append("Python")
        if index < 2:
            skills.append("Kubernetes")
        if index == 0:
            skills.append("Terraform")
        _add_evaluated_candidate(
            db,
            job.id,
            name=f"Candidate {index}",
            email=f"candidate{index}@example.com",
            skills=skills,
        )

    response = client.get(f"/api/dashboard/job/{job.id}/jd-optimization")
    assert response.status_code == 200
    payload = response.json()

    classifications = {item["skill"]: item["classification"] for item in payload["suggestions"]}
    assert classifications["Kubernetes"] == "too_strict"
    assert classifications["Python"] == "low_signal"
    assert classifications["Docker"] == "balanced"
    assert classifications["Terraform"] == "under_filtered"


def test_dashboard_insights_includes_jd_summary_counts(client, db):
    job = JobPosting(
        id=uuid.uuid4(),
        title="Platform Engineer",
        description="Need Kubernetes, Python, Docker and Terraform",
        required_skills=["Kubernetes", "Python", "Docker"],
        nice_to_have_skills=["Terraform"],
        created_by="recruiter@example.com",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    for index in range(10):
        skills = ["Docker"]
        if index < 9:
            skills.append("Python")
        if index < 2:
            skills.append("Kubernetes")
        if index == 0:
            skills.append("Terraform")
        _add_evaluated_candidate(
            db,
            job.id,
            name=f"Candidate {index}",
            email=f"candidate{index}@example.com",
            skills=skills,
        )

    response = client.get(f"/api/dashboard/job/{job.id}/insights")
    assert response.status_code == 200
    payload = response.json()
    assert payload["jd_suggestions_count"] == 4
    assert payload["jd_top_flag"] == "too_strict"