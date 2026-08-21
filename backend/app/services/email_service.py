"""Outbound email delivery via Gmail SMTP.

Mirrors the USE_MOCK_AZURE pattern used elsewhere in this app: if
SMTP_USERNAME/SMTP_PASSWORD aren't configured, emails are logged instead of
sent so the rest of the approve/reject flow is fully exercisable without
real credentials. Once real credentials are set, the exact same code path
sends for real over smtplib.
"""

from __future__ import annotations

import smtplib
from datetime import datetime, timedelta, timezone
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
            logger.warning(
                "EMAIL NOT SENT — SMTP is not configured. Set SMTP_USERNAME and "
                "SMTP_PASSWORD in .env to deliver mail for real.\n"
                "Would have sent:\nTo: %s <%s>\nSubject: %s\n---\n%s",
                to_name,
                to_email,
                subject,
                text_body,
            )
            # `sent` means "handed to an SMTP server". Reporting True here
            # meant the record, the audit log and the UI all claimed the
            # candidate had been emailed when nothing left the machine --
            # the failure was invisible until someone asked why no mail
            # arrived. An unconfigured mailer has not sent anything.
            return EmailResult(
                sent=False,
                source="mock",
                error="SMTP is not configured (set SMTP_USERNAME and SMTP_PASSWORD in backend/.env)",
            )

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

    def send(
        self,
        *,
        to_email: str,
        subject: str,
        body_text: str,
        to_name: str = "",
        html_body: str | None = None,
    ) -> EmailResult:
        """Compatibility wrapper used by interview scheduling."""
        return self.send_email(
            to_email=to_email,
            to_name=to_name or to_email,
            subject=subject,
            html_body=html_body or body_text.replace("\n", "<br>"),
            text_body=body_text,
        )


    def send_decision_notification(
        self,
        *,
        candidate_email: str,
        candidate_name: str,
        job_title: str,
        decision: str,
        notes: str = "",
    ) -> EmailResult:
        subject = f"Update regarding your application for {job_title}"
        body = f"Hello {candidate_name},\n\n{notes}\n\nBest regards,\nRecruiting Team"
        return self.send(to_email=candidate_email, to_name=candidate_name, subject=subject, body_text=body)


    def send_password_reset(
        self,
        *,
        to_email: str,
        to_name: str,
        reset_url: str,
        minutes_valid: int,
    ) -> EmailResult:
        """The reset link.

        Deliberately plain: a password email that looks like marketing is
        the one people distrust. It says what was requested, how long the
        link lasts, and what to do if it was not them.
        """
        subject = "Reset your ResumeIQ password"
        text = (
            f"Hi {to_name},\n\n"
            "Someone asked to reset the password on your ResumeIQ account.\n\n"
            f"Reset it here (the link works for {minutes_valid} minutes):\n"
            f"{reset_url}\n\n"
            "If this wasn't you, ignore this email — your password has not "
            "changed and the link will expire on its own.\n"
        )
        html = f"""
        <div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
          <p>Hi {to_name},</p>
          <p>Someone asked to reset the password on your ResumeIQ account.</p>
          <p>
            <a href="{reset_url}"
               style="display:inline-block;background:#5b3df5;color:#fff;padding:10px 18px;
                      border-radius:8px;text-decoration:none;font-weight:600">
              Reset your password
            </a>
          </p>
          <p style="color:#555">This link works for {minutes_valid} minutes.</p>
          <p style="color:#555">
            If this wasn't you, ignore this email — your password has not changed
            and the link will expire on its own.
          </p>
        </div>
        """
        return self.send_email(
            to_email=to_email, to_name=to_name, subject=subject, html_body=html, text_body=text
        )

    def send_assessment_invitation(
        self,
        *,
        candidate_email: str,
        candidate_name: str,
        job_title: str,
        assessment_title: str,
        target_competency: str,
        assessment_url: str,
        duration_minutes: int = 45,
        due_days: int = 5,
    ) -> EmailResult:
        """Invite a candidate to take an assessment.

        A real invitation, not a status update: it says what the assessment
        covers, how long it takes, when it is due, and carries the link. The
        link points at ASSESSMENT_BASE_URL, which is a placeholder host until
        a real assessment provider is wired up — the sending path, the record
        and the audit trail are all real.
        """
        due_date = (datetime.now(timezone.utc) + timedelta(days=due_days)).strftime("%d %B %Y")
        subject = f"Your {assessment_title} for {job_title}"

        html = f"""
        <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;">
          <p>Hi {candidate_name},</p>
          <p>
            Thanks for your interest in the <strong>{job_title}</strong> role. The next step is a
            short assessment so we can see your <strong>{target_competency}</strong> in practice.
          </p>
          <table style="width:100%;border-collapse:collapse;margin:18px 0;">
            <tr><td style="padding:6px 0;color:#6b7280;">Assessment</td><td style="padding:6px 0;"><strong>{assessment_title}</strong></td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Focus</td><td style="padding:6px 0;">{target_competency}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Time needed</td><td style="padding:6px 0;">about {duration_minutes} minutes</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Please complete by</td><td style="padding:6px 0;">{due_date}</td></tr>
          </table>
          <p style="margin:24px 0;">
            <a href="{assessment_url}"
               style="background:#4f46e5;color:#fff;padding:11px 22px;border-radius:10px;
                      text-decoration:none;font-weight:600;display:inline-block;">
              Start the assessment
            </a>
          </p>
          <p style="color:#6b7280;font-size:13px;">
            You can take it in one sitting whenever suits you before the date above. If the button
            does not work, paste this into your browser:<br>
            <span style="word-break:break-all;">{assessment_url}</span>
          </p>
          <p>Good luck,<br>Recruiting Team</p>
        </div>
        """

        text = (
            f"Hi {candidate_name},\n\n"
            f"Thanks for your interest in the {job_title} role. The next step is a short "
            f"assessment so we can see your {target_competency} in practice.\n\n"
            f"Assessment: {assessment_title}\n"
            f"Focus: {target_competency}\n"
            f"Time needed: about {duration_minutes} minutes\n"
            f"Please complete by: {due_date}\n\n"
            f"Start here: {assessment_url}\n\n"
            "You can take it in one sitting whenever suits you before the date above.\n\n"
            "Good luck,\nRecruiting Team\n"
        )

        return self.send_email(
            to_email=candidate_email,
            to_name=candidate_name,
            subject=subject,
            html_body=html,
            text_body=text,
        )


email_service = EmailService()


def send_decision_notification(
    *,
    candidate_email: str,
    candidate_name: str,
    job_title: str,
    decision: str,
    notes: str = "",
) -> EmailResult:
    return email_service.send_decision_notification(
        candidate_email=candidate_email,
        candidate_name=candidate_name,
        job_title=job_title,
        decision=decision,
        notes=notes,
    )


