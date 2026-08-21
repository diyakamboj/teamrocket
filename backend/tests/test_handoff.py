import pytest

from app.models.schemas import WeightConfig
from app.services.candidate_matcher import CandidateMatcher


@pytest.mark.asyncio
async def test_rescoring_logs_created_then_updated_history_events(db, sample_candidate, sample_job):
    matcher = CandidateMatcher()
    await matcher.rank_candidates(db, sample_job.id, weight_config=WeightConfig(), persist=True)
    await matcher.rank_candidates(db, sample_job.id, weight_config=WeightConfig(), persist=True)

    from app.services import handoff_service

    events = handoff_service.get_history(db, str(sample_candidate.id), str(sample_job.id))
    types = [e.event_type for e in events]
    assert types.count("evaluation_created") == 1
    assert types.count("evaluation_updated") == 1
    # Most recent first
    assert events[0].event_type == "evaluation_updated"


def test_candidate_decision_logs_history_event(client):
    response = client.post(
        "/api/candidates/decision",
        json={
            "candidate_id": "mock-candidate-1",
            "name": "Jamie Rivera",
            "email": "jamie.rivera@example.com",
            "decision": "approved",
            "job_title": "Backend Engineer",
        },
    )
    assert response.status_code == 200

    history = client.get("/api/handoff/history/mock-candidate-1")
    assert history.status_code == 200
    events = history.json()
    assert any(e["event_type"] == "decision_approved" for e in events)


def test_create_view_and_acknowledge_handoff(client):
    create = client.post(
        "/api/handoff",
        json={
            "candidate_id": "mock-candidate-2",
            "candidate_name": "Priya Nair",
            "candidate_email": "priya.nair@example.com",
            "job_id": None,
            "job_title": "Backend Engineer",
            "interviewer_name": "Sam Lee",
            "interviewer_email": "sam.lee@example.com",
            "recruiter_notes": "Strong on system design, verify Kubernetes depth.",
            "scorecard": {"overall_score": 88.5, "skill_score": 91},
            "matched_skills": [{"skill": "Python", "source": "Skills"}],
            "missing_skills": ["Kubernetes"],
            "strengths": "Deep backend experience",
            "weaknesses": "Limited Kubernetes exposure",
            "evidence_highlights": [],
        },
    )
    assert create.status_code == 200
    handoff = create.json()
    assert handoff["status"] == "pending"
    # Nothing is actually delivered without SMTP credentials, and the record
    # must say so rather than reporting a send that never happened.
    assert handoff["email_sent"] is False
    assert handoff["email_source"] == "mock"
    assert handoff["briefing"]["interview_focus_areas"]
    handoff_id = handoff["id"]

    viewed = client.post(f"/api/handoff/{handoff_id}/view")
    assert viewed.status_code == 200
    assert viewed.json()["status"] == "viewed"
    assert viewed.json()["viewed_at"] is not None

    acknowledged = client.post(
        f"/api/handoff/{handoff_id}/acknowledge",
        json={"interviewer_notes": "Confirmed depth in distributed systems."},
    )
    assert acknowledged.status_code == 200
    body = acknowledged.json()
    assert body["status"] == "acknowledged"
    assert body["interviewer_notes"] == "Confirmed depth in distributed systems."

    listed = client.get("/api/handoff/candidate/mock-candidate-2/list")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    history = client.get("/api/handoff/history/mock-candidate-2")
    types = [e["event_type"] for e in history.json()]
    assert "handoff_created" in types
    assert "handoff_viewed" in types
    assert "handoff_acknowledged" in types


def test_get_unknown_handoff_returns_404(client):
    response = client.get("/api/handoff/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
