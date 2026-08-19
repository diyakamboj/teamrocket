"""Composes and sends the approve/reject candidate emails."""

from __future__ import annotations

from dataclasses import dataclass

from app.config import settings
from app.services.calendar_links import InterviewSlot, build_interview_slots
from app.services.email_service import EmailResult, email_service


@dataclass
class DecisionOutcome:
    email_result: EmailResult
    slots: list[InterviewSlot]


def _approve_email(candidate_name: str, job_title: str, slots: list[InterviewSlot]) -> tuple[str, str, str]:
    subject = f"You've been selected — {job_title}"

    slot_rows_html = "".join(
        f'<tr><td style="padding:8px 0;">{s.label}</td>'
        f'<td style="padding:8px 0;"><a href="{s.outlook_url}" '
        f'style="background:#4f46e5;color:#fff;padding:8px 16px;border-radius:8px;'
        f'text-decoration:none;font-weight:600;font-size:13px;">Add to Outlook Calendar</a></td></tr>'
        for s in slots
    )
    html = f"""
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;">
      <p>Hi {candidate_name},</p>
      <p>Congratulations — you've been <strong>selected to move forward</strong> for the
      <strong>{job_title}</strong> role. We were impressed with your background and would like
      to schedule the next round.</p>
      <p><strong>Pick a time below to add the interview straight to your Outlook calendar:</strong></p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0;">{slot_rows_html}</table>
      <p>If none of these work, just reply to this email and we'll find another time.</p>
      <p>Looking forward to speaking with you!</p>
      <p>— {settings.SMTP_FROM_NAME}</p>
    </div>
    """

    slot_lines = "\n".join(f"- {s.label}: {s.outlook_url}" for s in slots)
    text = (
        f"Hi {candidate_name},\n\n"
        f"Congratulations — you've been selected to move forward for the {job_title} role.\n\n"
        f"Pick a time to add the interview to your Outlook calendar:\n{slot_lines}\n\n"
        f"If none of these work, reply to this email and we'll find another time.\n\n"
        f"— {settings.SMTP_FROM_NAME}"
    )
    return subject, html, text


def _reject_email(candidate_name: str, job_title: str) -> tuple[str, str, str]:
    subject = f"Update on your application — {job_title}"
    html = f"""
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;">
      <p>Hi {candidate_name},</p>
      <p>Thank you for taking the time to apply for the <strong>{job_title}</strong> role and for
      sharing your background with us.</p>
      <p>After careful review, we've decided to move forward with other candidates whose
      experience more closely matches this specific role at this time. This isn't a reflection
      of your qualifications, and we'd encourage you to apply again for future openings that fit
      your profile.</p>
      <p>We wish you the best in your search.</p>
      <p>— {settings.SMTP_FROM_NAME}</p>
    </div>
    """
    text = (
        f"Hi {candidate_name},\n\n"
        f"Thank you for applying for the {job_title} role. After careful review, we've decided "
        f"to move forward with other candidates at this time. We'd encourage you to apply again "
        f"for future openings that fit your profile.\n\n"
        f"— {settings.SMTP_FROM_NAME}"
    )
    return subject, html, text


#: What a recruiter can do to a candidate, in pipeline order. "advanced"
#: moves them to the next round; "approved" is a final selection; "hired"
#: closes the loop with an offer.
CANDIDATE_DECISIONS = ("advanced", "approved", "hired", "rejected")


def _advance_email(candidate_name: str, job_title: str, slots: list[InterviewSlot]) -> tuple[str, str, str]:
    """Moving to the next round is not the same message as a final selection —
    it invites the candidate to the next stage rather than congratulating
    them on the outcome."""
    subject = f"Next round — {job_title}"
    slot_rows_html = "".join(
        f'<tr><td style="padding:8px 0;">{s.label}</td>'
        f'<td style="padding:8px 0;"><a href="{s.outlook_url}">Add to calendar</a></td></tr>'
        for s in slots
    )
    html = f"""
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;">
      <p>Hi {candidate_name},</p>
      <p>Good news — you're moving on to the next round for <strong>{job_title}</strong>.</p>
      <p>Here are some times that work on our side:</p>
      <table style="width:100%;border-collapse:collapse;">{slot_rows_html}</table>
      <p>Reply with whichever suits you and we'll confirm.</p>
    </div>
    """
    text = (
        f"Hi {candidate_name},\n\nYou're moving on to the next round for {job_title}.\n"
        + "\n".join(f"- {s.label}" for s in slots)
        + "\n\nReply with whichever suits you and we'll confirm.\n"
    )
    return subject, html, text


def _hired_email(candidate_name: str, job_title: str) -> tuple[str, str, str]:
    subject = f"Offer — {job_title}"
    html = f"""
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;">
      <p>Hi {candidate_name},</p>
      <p>We'd like to offer you the <strong>{job_title}</strong> role. Congratulations!</p>
      <p>Your recruiter will follow up with the paperwork and a start date.</p>
    </div>
    """
    text = (
        f"Hi {candidate_name},\n\nWe'd like to offer you the {job_title} role. "
        "Congratulations! Your recruiter will follow up with the paperwork and a start date.\n"
    )
    return subject, html, text


def process_decision(
    *,
    candidate_name: str,
    candidate_email: str,
    decision: str,
    job_title: str,
    recruiter_email: str,
) -> DecisionOutcome:
    slots: list[InterviewSlot] = []

    if decision in ("approved", "advanced"):
        slots = build_interview_slots(
            candidate_name=candidate_name, job_title=job_title, recruiter_email=recruiter_email
        )
        subject, html, text = (
            _advance_email(candidate_name, job_title, slots)
            if decision == "advanced"
            else _approve_email(candidate_name, job_title, slots)
        )
    elif decision == "hired":
        subject, html, text = _hired_email(candidate_name, job_title)
    else:
        subject, html, text = _reject_email(candidate_name, job_title)

    result = email_service.send_email(
        to_email=candidate_email,
        to_name=candidate_name,
        subject=subject,
        html_body=html,
        text_body=text,
    )
    return DecisionOutcome(email_result=result, slots=slots)
