import pytest

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
