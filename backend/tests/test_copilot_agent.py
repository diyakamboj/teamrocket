"""Tests for the bounded recruiter copilot agent."""

import pytest

from app.services.copilot_agent import deterministic_answer, gap_summary, must_have_report, search_candidates
from app.services.copilot_pool import build_pool, job_requirements
from app.models.schemas import WeightConfig


def _sample_pool():
    ranked = [
        {
            "candidate_id": "11111111-1111-1111-1111-111111111111",
            "name": "Alice Smith",
            "skill_score": 90,
            "experience_score": 85,
            "education_score": 80,
            "certification_score": 70,
            "project_score": 75,
            "overall_score": 84,
            "years_of_experience": 6,
            "skills": ["Python", "Azure", "Docker"],
            "matched_skills": [{"skill": "Python"}, {"skill": "Azure"}],
            "missing_skills": ["Kubernetes"],
            "strengths": "Strong Python and cloud background.",
            "weaknesses": "Limited Kubernetes evidence.",
            "evidence": [
                {
                    "id": "ev-1",
                    "skill_name": "Python",
                    "resume_text_snippet": "Built APIs using Python",
                    "source_section": "Experience",
                }
            ],
        },
        {
            "candidate_id": "22222222-2222-2222-2222-222222222222",
            "name": "Bob Lee",
            "skill_score": 75,
            "experience_score": 70,
            "education_score": 65,
            "certification_score": 60,
            "project_score": 68,
            "overall_score": 70,
            "years_of_experience": 3,
            "skills": ["Python", "SQL"],
            "matched_skills": [{"skill": "Python"}],
            "missing_skills": ["Azure", "Docker"],
            "strengths": "Solid SQL and Python.",
            "weaknesses": "Limited cloud exposure.",
            "evidence": [],
        },
    ]
    requirements = [
        {"id": "req-0", "category": "Skills", "text": "Python", "must": True, "keywords": ["python"]},
        {"id": "req-1", "category": "Skills", "text": "Azure", "must": True, "keywords": ["azure"]},
    ]
    return build_pool(ranked, weights=WeightConfig(), blind=False, requirements=requirements)


def test_search_candidates_by_skill():
    pool = _sample_pool()
    result = search_candidates(pool, {"skill": "Azure"})
    assert "Alice Smith" in result["text"]
    assert "Bob Lee" not in result["text"]


def test_deterministic_compare_intent():
    pool = _sample_pool()
    answer = deterministic_answer("Compare the top 3 candidates", pool, [])
    assert answer["engine"] == "deterministic"
    assert "Alice Smith" in answer["answer"]
    assert answer["tools"] == ["compare"]


def test_gap_summary():
    pool = _sample_pool()
    result = gap_summary(pool, [])
    assert "commonGaps" in result["text"]


def test_must_have_report():
    pool = _sample_pool()
    requirements = job_requirements(
        type(
            "Job",
            (),
            {
                "required_skills": ["Python", "Azure"],
                "nice_to_have_skills": [],
                "required_experience_years": 3,
                "education_requirements": None,
            },
        )()
    )
    result = must_have_report(pool, requirements)
    assert "mustHaves" in result["text"]
