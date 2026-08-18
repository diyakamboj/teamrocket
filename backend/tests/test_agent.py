from uuid import uuid4

import pytest

from app.services.azure_services import openai_service
from app.services.recruiter_agent import RecruiterCopilot
from app.utils.error_handlers import AzureServiceError


@pytest.mark.asyncio
async def test_agent_ask_returns_session_and_response(db, sample_candidate, sample_job, monkeypatch):
    agent = RecruiterCopilot()
    result = await agent.query_candidates(
        db,
        job_id=sample_job.id,
        user_query="Show me top Python developers",
        recruiter_email="recruiter@example.com",
    )
    assert result["session_id"] is not None
    assert isinstance(result["response"], str)
    assert len(result["response"]) > 0
    assert result["chat_turn"] >= 1
    assert result["source"] in {"local", "fallback"}
    assert result["job_id"] == sample_job.id
    assert result["tool_used"] == "search_candidates"
    assert result["usage"]["llm_calls"] >= 1
    assert sample_candidate.id in result["candidates_referenced"] or "Alice" in result["response"]


@pytest.mark.asyncio
async def test_tool_selection_routes_common_queries(
    db, sample_candidate, sample_candidate_b, sample_job, monkeypatch
):
    agent = RecruiterCopilot()

    cases = [
        ("Compare Alice and Bob", "compare"),
        ("What's the biggest skill gap right now?", "gap_summary"),
        ("Who meets every must-have skill?", "must_have_report"),
        ("Who should I move to interview next?", "get_verdicts"),
        ("asdfgh", "clarify"),
    ]
    session_id = None
    for query, expected in cases:
        result = await agent.query_candidates(
            db,
            job_id=sample_job.id,
            user_query=query,
            recruiter_email="recruiter@example.com",
            session_id=session_id,
        )
        session_id = result["session_id"]
        assert result["tool_used"] == expected, f"{query} -> {result['tool_used']}"
        assert result["response"]


@pytest.mark.asyncio
async def test_multi_turn_reuses_pool_and_increments_turn(
    db, sample_candidate, sample_job, monkeypatch
):
    agent = RecruiterCopilot()
    first = await agent.query_candidates(
        db,
        job_id=sample_job.id,
        user_query="Show me top Python developers",
        recruiter_email="recruiter@example.com",
    )
    second = await agent.query_candidates(
        db,
        job_id=sample_job.id,
        user_query="Who should I interview next?",
        recruiter_email="recruiter@example.com",
        session_id=first["session_id"],
    )
    assert second["session_id"] == first["session_id"]
    assert second["chat_turn"] == first["chat_turn"] + 1
    assert second["usage"]["pool_reused"] is True
    # Ranking explanations are not re-run; only select + synthesize.
    assert second["usage"]["llm_calls"] <= 2


@pytest.mark.asyncio
async def test_candidate_and_job_context(
    db, sample_candidate, sample_candidate_b, sample_job, monkeypatch
):
    agent = RecruiterCopilot()
    result = await agent.query_candidates(
        db,
        job_id=sample_job.id,
        user_query="Give me a verdict",
        recruiter_email="recruiter@example.com",
        candidate_ids=[str(sample_candidate_b.id)],
        focus_names=["Bob Martinez"],
        job_title=sample_job.title,
        blind_mode=False,
    )
    assert result["tool_used"] == "get_verdicts"
    assert "Bob" in result["response"]
    assert "Alice" not in result["response"]


@pytest.mark.asyncio
async def test_citation_resolution_rejects_fabricated_evidence(
    db, sample_candidate, sample_job, monkeypatch
):
    fake_id = "00000000-0000-0000-0000-00000000dead"

    def fake_synth(self, tool_result, *, blind_mode):
        real_ids = list(tool_result.get("evidence_index") or {})
        real = real_ids[0] if real_ids else str(uuid4())
        return (
            f"Python is evidenced [evidence:{real}] "
            f"but Rust is fabricated [evidence:{fake_id}]."
        )

    monkeypatch.setattr(RecruiterCopilot, "_synthesize", fake_synth)
    agent = RecruiterCopilot()
    result = await agent.query_candidates(
        db,
        job_id=sample_job.id,
        user_query="Show me top Python developers",
        recruiter_email="recruiter@example.com",
    )
    citation_ids = {str(c.get("id")).lower() for c in result["citations"]}
    assert fake_id not in result["response"]
    assert fake_id not in citation_ids
    if result["citations"]:
        assert all(c.get("snippet") for c in result["citations"])


@pytest.mark.asyncio
async def test_blind_mode_redacts_identity(
    db, sample_candidate, sample_job, monkeypatch
):
    agent = RecruiterCopilot()
    result = await agent.query_candidates(
        db,
        job_id=sample_job.id,
        user_query="Give me a verdict on this candidate",
        recruiter_email="recruiter@example.com",
        candidate_ids=[str(sample_candidate.id)],
        blind_mode=True,
    )
    assert "Alice" not in result["response"]
    assert "alice.johnson" not in result["response"].lower()
    assert "Candidate #" in result["response"]


@pytest.mark.asyncio
async def test_azure_failure_uses_deterministic_fallback(
    db, sample_candidate, sample_job, monkeypatch
):
    def boom(*_args, **_kwargs):
        raise AzureServiceError("Azure unavailable")

    monkeypatch.setattr(openai_service, "chat_json", boom)
    monkeypatch.setattr(openai_service, "chat_text", boom)

    agent = RecruiterCopilot()
    result = await agent.query_candidates(
        db,
        job_id=sample_job.id,
        user_query="What's the biggest skill gap?",
        recruiter_email="recruiter@example.com",
    )
    assert result["source"] == "fallback"
    assert result["tool_used"] == "gap_summary"
    assert result["response"]
    assert result["usage"]["selection_source"] == "heuristic"


@pytest.mark.asyncio
async def test_invalid_query_clarifies(db, sample_candidate, sample_job, monkeypatch):
    agent = RecruiterCopilot()
    result = await agent.query_candidates(
        db,
        job_id=sample_job.id,
        user_query="asdfgh",
        recruiter_email="recruiter@example.com",
    )
    assert result["tool_used"] == "clarify"
    assert "more specific" in result["response"].lower() or "try one of" in result["response"].lower()


def test_agent_status_lists_tools(client):
    response = client.get("/api/agent/status")
    assert response.status_code == 200
    body = response.json()
    assert body["local_agent"] is True
    assert "search_candidates" in body["tools"]
    assert "must_have_report" in body["tools"]


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"


def test_create_job_endpoint(client):
    response = client.post(
        "/api/jobs",
        json={
            "title": "Data Engineer",
            "description": "Python, SQL, Spark, Azure experience required.",
            "required_skills": ["Python", "SQL"],
            "required_experience_years": 2,
        },
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Data Engineer"


def test_agent_ask_endpoint(client, sample_job, sample_candidate):
    response = client.post(
        "/api/agent/ask",
        json={
            "query": "Show me top Python developers",
            "job_id": str(sample_job.id),
            "blind_mode": False,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["tool_used"] in {
        "search_candidates",
        "get_verdicts",
        "compare",
        "gap_summary",
        "must_have_report",
        "clarify",
    }
    assert body["response"]
    assert "usage" in body
