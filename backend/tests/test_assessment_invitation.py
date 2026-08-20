"""Approve & Send Assessment actually sends an invitation.

The button used to fire a generic "update regarding your application" with no
link, so a candidate had nothing to act on. These pin the invitation's
content and that the outcome is recorded rather than assumed.
"""

import uuid

import pytest

from app.models.candidate import Candidate
from app.services import readiness_service as readiness_module
from app.services.email_service import EmailResult

RECRUITER = {"X-Recruiter-Email": "recruiter@example.com"}


@pytest.fixture()
def sent_emails(monkeypatch):
    """Capture invitations instead of sending them."""
    captured = []

    def fake_send(**kwargs):
        captured.append(kwargs)
        return EmailResult(sent=True, source="mock")

    monkeypatch.setattr(readiness_module.email_service, "send_assessment_invitation", fake_send)
    return captured


@pytest.fixture()
def candidate(store):
    person = Candidate(
        owner_email="recruiter@example.com",
        name="Maya Okonkwo",
        email="maya@example.com",
        skills=["Python"],
    )
    store.candidates.save(person)
    return person


def trigger(client, candidate, **overrides):
    return client.post(
        "/api/readiness/trigger",
        json={
            "candidate_id": str(candidate.id),
            "assessment_type": "technical_depth",
            "target_competency": "Kubernetes operations",
            **overrides,
        },
        headers=RECRUITER,
    )


def test_approving_sends_an_invitation_to_the_candidate(client, candidate, sent_emails):
    response = trigger(client, candidate)
    assert response.status_code == 200
    assert len(sent_emails) == 1
    assert sent_emails[0]["candidate_email"] == "maya@example.com"
    assert sent_emails[0]["candidate_name"] == "Maya Okonkwo"


def test_the_invitation_carries_a_link_the_candidate_can_open(client, candidate, sent_emails):
    trigger(client, candidate)
    assert sent_emails[0]["assessment_url"].startswith("http")


def test_the_invitation_names_what_is_being_assessed(client, candidate, sent_emails):
    trigger(client, candidate, target_competency="Kubernetes operations")
    assert sent_emails[0]["target_competency"] == "Kubernetes operations"
    assert sent_emails[0]["assessment_title"]


def test_the_record_says_whether_it_was_sent_or_only_logged(client, candidate, sent_emails):
    record = trigger(client, candidate).json()

    assert record["notification_sent"] is True
    assert record["notification_source"] == "mock"
    assert record["assessment_url"].endswith(record["id"])


def test_a_failed_send_is_recorded_rather_than_hidden(client, candidate, monkeypatch):
    monkeypatch.setattr(
        readiness_module.email_service,
        "send_assessment_invitation",
        lambda **kw: EmailResult(sent=False, source="live", error="smtp refused"),
    )
    record = trigger(client, candidate).json()

    assert record["notification_sent"] is False
    assert record["notification_error"] == "smtp refused"


def test_the_assessment_is_persisted_against_the_candidate(client, candidate, sent_emails):
    trigger(client, candidate)
    listed = client.get(f"/api/readiness/candidate/{candidate.id}", headers=RECRUITER).json()

    assert len(listed) == 1
    assert listed[0]["target_competency"] == "Kubernetes operations"


def test_triggering_for_an_unknown_candidate_is_404(client, sent_emails):
    response = client.post(
        "/api/readiness/trigger",
        json={"candidate_id": str(uuid.uuid4()), "target_competency": "anything"},
        headers=RECRUITER,
    )
    assert response.status_code == 404
    assert sent_emails == []


# ---------- the email body itself ----------


def test_invitation_body_contains_the_details_a_candidate_needs():
    from app.services.email_service import email_service

    captured = {}

    def fake_send_email(**kwargs):
        captured.update(kwargs)
        return EmailResult(sent=True, source="mock")

    original = email_service.send_email
    email_service.send_email = fake_send_email  # type: ignore[assignment]
    try:
        email_service.send_assessment_invitation(
            candidate_email="maya@example.com",
            candidate_name="Maya Okonkwo",
            job_title="Platform Engineer",
            assessment_title="Technical Depth Assessment",
            target_competency="Kubernetes operations",
            assessment_url="https://assessments.example/take/abc",
            duration_minutes=45,
        )
    finally:
        email_service.send_email = original  # type: ignore[assignment]

    text = captured["text_body"]
    assert "Maya Okonkwo" in text
    assert "Platform Engineer" in text
    assert "Kubernetes operations" in text
    assert "https://assessments.example/take/abc" in text
    assert "45 minutes" in text
    assert "https://assessments.example/take/abc" in captured["html_body"]
    assert "Technical Depth Assessment" in captured["subject"]
