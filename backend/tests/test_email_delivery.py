"""The live SMTP send path.

Everything here is about what happens once SMTP credentials exist. Delivery
itself depends on the operator's mailbox, but the message we hand to the
server -- recipients, headers, both MIME parts -- is ours to get right, and
regressions in it are invisible in mock mode.
"""

import smtplib
from email import message_from_string

import pytest

from app.config import settings
from app.services.email_service import EmailService


class RecordingSMTP:
    """Stands in for smtplib.SMTP, recording the conversation."""

    instances: list["RecordingSMTP"] = []

    def __init__(self, host, port, timeout=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.calls: list[str] = []
        self.login_args: tuple | None = None
        self.sendmail_args: tuple | None = None
        RecordingSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.calls.append("quit")
        return False

    def starttls(self):
        self.calls.append("starttls")

    def login(self, username, password):
        self.calls.append("login")
        self.login_args = (username, password)

    def sendmail(self, from_addr, to_addrs, message):
        self.calls.append("sendmail")
        self.sendmail_args = (from_addr, to_addrs, message)


@pytest.fixture
def configured_mailer(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_USERNAME", "recruiter@example.com")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "app-password")
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", None)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "SMTP_PORT", 587)
    RecordingSMTP.instances = []
    monkeypatch.setattr(smtplib, "SMTP", RecordingSMTP)
    return EmailService()


def test_unconfigured_mailer_reports_that_nothing_was_sent():
    """The bug behind "the emailing thing doesn't work"."""
    service = EmailService()
    service.mock = True
    result = service.send_email(
        to_email="candidate@example.com",
        to_name="Ada Vance",
        subject="Assessment",
        html_body="<p>hi</p>",
        text_body="hi",
    )
    assert result.sent is False
    assert result.source == "mock"
    assert "SMTP is not configured" in (result.error or "")


def test_configured_mailer_actually_hands_the_message_to_smtp(configured_mailer):
    result = configured_mailer.send_email(
        to_email="candidate@example.com",
        to_name="Ada Vance",
        subject="Your assessment invitation",
        html_body="<p>Please complete the assessment.</p>",
        text_body="Please complete the assessment.",
    )

    assert result.sent is True
    assert result.source == "live"
    assert result.error is None

    conversation = RecordingSMTP.instances[-1]
    # TLS must be negotiated before credentials go over the wire.
    assert conversation.calls == ["starttls", "login", "sendmail", "quit"]
    assert conversation.login_args == ("recruiter@example.com", "app-password")

    from_addr, to_addrs, raw = conversation.sendmail_args
    assert from_addr == "recruiter@example.com"
    assert to_addrs == ["candidate@example.com"]

    message = message_from_string(raw)
    assert message["Subject"] == "Your assessment invitation"
    assert "candidate@example.com" in message["To"]
    # Both alternatives are required: text-only clients must still be readable.
    types = {part.get_content_type() for part in message.walk() if part.get_payload(decode=True)}
    assert types == {"text/plain", "text/html"}


def test_smtp_failure_is_reported_not_swallowed(configured_mailer, monkeypatch):
    def explode(*args, **kwargs):
        raise smtplib.SMTPAuthenticationError(535, b"bad credentials")

    monkeypatch.setattr(RecordingSMTP, "login", explode)
    result = configured_mailer.send_email(
        to_email="candidate@example.com",
        to_name="Ada Vance",
        subject="Assessment",
        html_body="<p>hi</p>",
        text_body="hi",
    )
    assert result.sent is False
    assert result.source == "live"
    assert "535" in (result.error or "")


def test_assessment_invitation_carries_the_assessment_link(configured_mailer):
    result = configured_mailer.send_assessment_invitation(
        candidate_email="candidate@example.com",
        candidate_name="Ada Vance",
        job_title="Backend Engineer",
        assessment_title="Readiness Assessment: System Design",
        target_competency="System Design",
        assessment_url="https://example.test/assessment/abc-123",
    )
    assert result.sent is True

    _, _, raw = RecordingSMTP.instances[-1].sendmail_args
    message = message_from_string(raw)
    bodies = "".join(
        part.get_payload(decode=True).decode()
        for part in message.walk()
        if part.get_payload(decode=True)
    )
    assert "https://example.test/assessment/abc-123" in bodies
    assert "Ada Vance" in bodies
    assert "Backend Engineer" in bodies
