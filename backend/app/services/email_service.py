"""Outbound email delivery via Gmail SMTP.

Mirrors the USE_MOCK_AZURE pattern used elsewhere in this app: if
SMTP_USERNAME/SMTP_PASSWORD aren't configured, emails are logged instead of
sent so the rest of the approve/reject flow is fully exercisable without
real credentials. Once real credentials are set, the exact same code path
sends for real over smtplib.
"""

from __future__ import annotations

import smtplib
from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings
from app.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class EmailResult:
    sent: bool
    source: str  # "live" | "mock"
    error: str | None = None


class EmailService:
    def __init__(self) -> None:
        self.mock = not settings.smtp_configured

    def send_email(
        self,
        *,
        to_email: str,
        to_name: str,
        subject: str,
        html_body: str,
        text_body: str,
    ) -> EmailResult:
        if self.mock:
            logger.info(
                "MOCK EMAIL (SMTP not configured — set SMTP_USERNAME/SMTP_PASSWORD in "
                ".env to send for real)\nTo: %s <%s>\nSubject: %s\n---\n%s",
                to_name,
                to_email,
                subject,
                text_body,
            )
            return EmailResult(sent=True, source="mock")

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.smtp_from}>"
        msg["To"] = f"{to_name} <{to_email}>"
        msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        try:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
                server.starttls()
                server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                server.sendmail(settings.smtp_from, [to_email], msg.as_string())
            logger.info("Email sent to %s <%s>: %s", to_name, to_email, subject)
            return EmailResult(sent=True, source="live")
        except Exception as exc:  # noqa: BLE001 - surface as a soft failure, not a 500
            logger.exception("Failed to send email to %s", to_email)
            return EmailResult(sent=False, source="live", error=str(exc))


email_service = EmailService()
