from uuid import uuid4

from app.services.agent_tools import (
    execute_tool,
    format_tool_result,
    resolve_citations,
    select_tool_heuristic,
)


def _pool():
    alice_ev = str(uuid4())
    bob_ev = str(uuid4())
    return [
        {
            "candidate_id": uuid4(),
            "name": "Alice Johnson",
            "rank": 1,
            "overall_score": 91.0,
            "skill_score": 94.0,
            "experience_score": 100.0,
            "education_score": 90.0,
            "certification_score": 80.0,
            "project_score": 70.0,
            "matched_skills": ["Python", "SQL", "Azure", "Docker"],
            "missing_skills": [],
            "skills": ["Python", "SQL", "Azure", "Docker"],
            "strengths": "Strong Python/Azure",
            "weaknesses": "",
            "evidence": [
                {
                    "id": alice_ev,
                    "skill_name": "Python",
                    "resume_text_snippet": "Built Python APIs on Azure",
                    "source_section": "Experience",
                    "confidence_score": 0.9,
                }
            ],
        },
        {
            "candidate_id": uuid4(),
            "name": "Bob Martinez",
            "rank": 2,
            "overall_score": 48.0,
            "skill_score": 25.0,
            "experience_score": 50.0,
            "education_score": 40.0,
            "certification_score": 20.0,
            "project_score": 30.0,
            "matched_skills": ["SQL"],
            "missing_skills": ["Python", "Azure", "Docker"],
            "skills": ["Java", "SQL"],
            "strengths": "SQL reporting",
            "weaknesses": "Missing cloud stack",
            "evidence": [
                {
                    "id": bob_ev,
                    "skill_name": "SQL",
                    "resume_text_snippet": "SQL reporting",
                    "source_section": "Experience",
                    "confidence_score": 0.8,
                }
            ],
        },
    ]


JOB = {
    "title": "Backend Engineer",
    "required_skills": ["Python", "SQL", "Azure", "Docker"],
    "nice_to_have_skills": ["Kubernetes"],
}


def test_heuristic_tool_selection():
    assert select_tool_heuristic("compare Alice and Bob")[0] == "compare"
    assert select_tool_heuristic("What's the biggest skill gap?")[0] == "gap_summary"
    assert select_tool_heuristic("Who meets every must-have skill?")[0] == "must_have_report"
    assert select_tool_heuristic("Who should I interview next?")[0] == "get_verdicts"
    assert select_tool_heuristic("Show me top Python developers")[0] == "search_candidates"
    assert select_tool_heuristic("asdfgh")[0] == "clarify"
    assert select_tool_heuristic("?")[0] == "clarify"
    assert select_tool_heuristic("verdict", focus_count=1)[0] == "get_verdicts"
    assert select_tool_heuristic("look at these two", focus_count=2)[0] == "compare"


def test_search_candidates_prefers_python_match():
    result = execute_tool(
        "search_candidates",
        {"query": "Python", "limit": 5},
        pool=_pool(),
        job=JOB,
        focus=[],
        blind_mode=False,
        query="Show me top Python developers",
    )
    assert result["ok"]
    names = [c["display_name"] for c in result["payload"]["candidates"]]
    assert names[0] == "Alice Johnson"
    assert result["evidence_index"]


def test_get_verdicts_and_compare_and_reports():
    pool = _pool()
    verdicts = execute_tool("get_verdicts", {}, pool=pool, job=JOB, focus=[], blind_mode=False, query="verdicts")
    assert verdicts["payload"]["candidates"][0]["verdict"] == "Strong fit"
    assert verdicts["payload"]["candidates"][-1]["verdict"] == "Weak fit"

    compare = execute_tool("compare", {}, pool=pool, job=JOB, focus=pool, blind_mode=False, query="compare them")
    text = format_tool_result(compare)
    assert "Alice Johnson" in text
    assert "Recommendation" in text

    gaps = execute_tool("gap_summary", {}, pool=pool, job=JOB, focus=[], blind_mode=False, query="gaps")
    skills = [g["skill"] for g in gaps["payload"]["gaps"]]
    assert "Python" in skills or "Azure" in skills

    report = execute_tool(
        "must_have_report", {}, pool=pool, job=JOB, focus=[], blind_mode=False, query="must haves"
    )
    assert "Alice Johnson" in report["payload"]["full_match_names"]
    assert "Bob Martinez" not in report["payload"]["full_match_names"]


def test_blind_mode_hides_names():
    pool = _pool()
    result = execute_tool(
        "get_verdicts", {}, pool=pool, job=JOB, focus=pool[:1], blind_mode=True, query="verdict"
    )
    names = [c["display_name"] for c in result["payload"]["candidates"]]
    assert names == ["Candidate #1"]
    assert "Alice" not in format_tool_result(result)


def test_citation_resolution_drops_fabricated_ids():
    real = str(uuid4())
    fake = "00000000-0000-0000-0000-000000000099"
    allowed = {
        real: {
            "skill_name": "Python",
            "resume_text_snippet": "Built Python APIs on Azure",
            "source_section": "Experience",
            "candidate_id": str(uuid4()),
        }
    }
    text = f"Knows Python [evidence:{real}] and invented Rust [evidence:{fake}]"
    cleaned, citations = resolve_citations(text, allowed)
    assert "Python" in cleaned
    assert fake not in cleaned
    assert "Rust" in cleaned
    assert len(citations) == 1
    assert citations[0]["id"] == real
    assert citations[0]["snippet"] == "Built Python APIs on Azure"


def test_compare_requires_two_candidates():
    pool = _pool()[:1]
    result = execute_tool("compare", {}, pool=pool, job=JOB, focus=pool, blind_mode=False, query="compare")
    assert result["ok"] is False
    assert "two" in result["payload"]["message"].lower()
