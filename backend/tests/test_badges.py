import pytest
from uuid import uuid4
from app.models.candidate import Candidate
from app.services.badge_service import build_badges, normalize_skill


def test_normalize_skill_aliases():
    assert normalize_skill("JS") == "javascript"
    assert normalize_skill("TS") == "typescript"
    assert normalize_skill("Py") == "python"
    assert normalize_skill("k8s") == "kubernetes"


def test_build_badges_for_candidate():
    candidate = Candidate(
        owner_email="recruiter@example.com",
        id=uuid4(),
        name="Alex River",
        email="alex@example.com",
        skills=["Python", "PostgreSQL", "Docker"],
        experience=[{"title": "Senior Engineer", "company": "Tech Corp"}],
        education=[{"degree": "BS CS", "institution": "University"}],
        resume_text="Senior Developer with 8 years of experience. Available immediately to start.",
    )
    score = {
        "overall_score": 85.0,
        "skill_score": 90.0,
        "matched_skills": ["Python", "Docker"],
    }
    badges = build_badges(candidate, score)
    flag_ids = [f.id for f in badges.status_flags]

    assert "top_match" in flag_ids
    assert "immediate_joiner" in flag_ids
    assert len(badges.skill_badges) > 0
