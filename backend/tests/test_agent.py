import pytest

from app.services.model_registry import ModelRegistry
from app.services.recruiter_agent import RecruiterCopilot


@pytest.mark.asyncio
async def test_agent_ask_returns_session_and_response(db, sample_candidate, sample_job, monkeypatch):
    from app.services import recruiter_agent as agent_module

    monkeypatch.setattr(agent_module.chatbot_client, "base_url", "")

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
    assert result["source"] == "local"
    assert result["job_id"] == sample_job.id


@pytest.mark.asyncio
async def test_agent_ask_binds_candidate_to_new_session(db, sample_candidate, sample_job, monkeypatch):
    from app.services import recruiter_agent as agent_module

    monkeypatch.setattr(agent_module.chatbot_client, "base_url", "")

    agent = RecruiterCopilot()
    result = await agent.query_candidates(
        db,
        job_id=sample_job.id,
        user_query="Show me top Python developers",
        recruiter_email="recruiter@example.com",
        candidate_id=sample_candidate.id,
    )
    assert result["candidate_id"] == sample_candidate.id

    session = db.agent_sessions.get(result["session_id"])
    assert session.candidate_id == sample_candidate.id
    assert session.candidate_name == sample_candidate.name
    assert session.title == "Show me top Python developers"


@pytest.mark.asyncio
async def test_agent_ask_resolves_pronoun_to_focus_candidate(db, sample_candidate, sample_job, monkeypatch):
    from app.services import recruiter_agent as agent_module

    monkeypatch.setattr(agent_module.chatbot_client, "base_url", "")

    agent = RecruiterCopilot()
    result = await agent.query_candidates(
        db,
        job_id=sample_job.id,
        user_query="Why was this candidate ranked here?",
        recruiter_email="recruiter@example.com",
        candidate_id=sample_candidate.id,
    )
    assert result["engine"] == "deterministic"
    assert result["tools"] == ["get_verdicts"]
    assert result["structured"] is not None
    assert result["structured"]["type"] == "evaluation_summary"
    assert result["structured"]["candidate"]["label"] == sample_candidate.name


@pytest.mark.asyncio
async def test_agent_ask_structured_payload_for_compare_query(db, sample_candidate, sample_job, monkeypatch):
    from app.services import recruiter_agent as agent_module

    monkeypatch.setattr(agent_module.chatbot_client, "base_url", "")

    agent = RecruiterCopilot()
    result = await agent.query_candidates(
        db,
        job_id=sample_job.id,
        user_query="Compare the top 3 candidates",
        recruiter_email="recruiter@example.com",
    )
    assert result["structured"] is not None
    assert result["structured"]["type"] == "ranking_list"
    assert result["structured"]["candidates"]


def test_model_registry_filters_by_allowlist(monkeypatch):
    from app import config as config_module

    monkeypatch.setattr(
        config_module.settings,
        "COPILOT_MODEL_ALLOWLIST",
        {"gpt-4.1": ["allowed@example.com"]},
    )
    registry = ModelRegistry()

    allowed_ids = {m["id"] for m in registry.list_for("allowed@example.com")}
    other_ids = {m["id"] for m in registry.list_for("someone-else@example.com")}

    assert "gpt-4.1" in allowed_ids
    assert "gpt-4.1" not in other_ids
    # Unrestricted models (not in the allowlist at all) stay available to everyone.
    assert "gpt-4o" in allowed_ids
    assert "gpt-4o" in other_ids
    assert registry.is_authorized("gpt-4.1", "allowed@example.com") is True
    assert registry.is_authorized("gpt-4.1", "someone-else@example.com") is False


def test_ask_agent_rejects_disallowed_model_id(client, sample_job, monkeypatch):
    from app.routes import agent as agent_routes

    monkeypatch.setattr(agent_routes.model_registry, "is_authorized", lambda model_id, email: False)

    response = client.post(
        "/api/agent/ask",
        json={"query": "Show me top candidates", "job_id": str(sample_job.id), "model_id": "gpt-4.1"},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["details"]["model_id"] == "gpt-4.1"


def test_get_models_endpoint(client):
    response = client.get("/api/agent/models")
    assert response.status_code == 200
    body = response.json()
    assert len(body["models"]) == 3
    assert body["default_model_id"]


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


def test_public_agent_endpoint_query(client, sample_job, sample_candidate):
    response = client.post(
        "/api/agent",
        json={
            "query": "Show me top candidates for Backend Engineer",
            "job_id": str(sample_job.id),
        },
        headers={"X-Recruiter-Email": "recruiter@example.com"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "session_id" in body
    assert "response" in body
    assert isinstance(body["response"], str)
    assert len(body["response"]) > 0


def test_public_agent_endpoint_question(client, sample_job, sample_candidate):
    response = client.post(
        "/api/agent",
        json={
            "question": "Which candidates meet must-have requirements?",
            "job_id": str(sample_job.id),
        },
        headers={"X-Recruiter-Email": "recruiter@example.com"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "session_id" in body
    assert "response" in body


def test_public_agent_endpoint_invalid_request(client):
    # Missing both 'query' and 'question'
    response = client.post(
        "/api/agent",
        json={"blind_mode": True},
        headers={"X-Recruiter-Email": "recruiter@example.com"},
    )
    assert response.status_code == 422

