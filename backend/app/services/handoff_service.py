"""Interview Handoff & Historical Data.

Two related capabilities live here:

1. A centralized, append-only log of everything that happens to a
   candidate's evaluation (re-scoring, decisions, blind-review toggles,
   handoff lifecycle) — evaluations themselves are upserted per
   candidate/job pair, so this log is the only place history survives.
2. Candidate summary briefings that recruiters hand off to technical
   interviewers, with view/acknowledge tracking so recruiters know the
   interviewer actually saw it before the loop.

History-event writes are best-effort (see module docstring in
app/storage/store.py and the plan's failure-handling policy): they are
secondary to the primary domain write (the Evaluation, the Handoff, ...)
and must never fail the request that triggered them.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.config import settings
from app.models.handoff import CandidateHistoryEvent, InterviewHandoff
from app.models.schemas import (
    BriefingScorecard,
    CandidateBriefing,
    HandoffCreateRequest,
)
from app.services.email_service import email_service
from app.storage.store import Store
from app.utils.logger import get_logger

logger = get_logger(__name__)

MAX_FOCUS_AREAS = 5


def build_history_event(
    *,
    candidate_id: str,
    event_type: str,
    candidate_name: Optional[str] = None,
    job_id: Optional[str] = None,
    job_title: Optional[str] = None,
    actor_email: Optional[str] = None,
    summary: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> CandidateHistoryEvent:
    """An unsaved history event, so callers writing many at once can batch."""
    return CandidateHistoryEvent(
        candidate_id=str(candidate_id),
        candidate_name=candidate_name,
        job_id=str(job_id) if job_id else None,
        job_title=job_title,
        event_type=event_type,
        actor_email=actor_email,
        summary=summary,
        details=details or {},
    )


def log_history_events(store: Store, events: list[CandidateHistoryEvent]) -> None:
    """Append many history events in one batch. Best-effort, like
    `log_history_event` — a failed audit trail must not fail the request."""
    if not events:
        return
    try:
        store.candidate_history_events.save_many(events)
    except Exception as exc:
        logger.warning("Failed to persist %d history events: %s", len(events), exc)


def log_history_event(
    store: Store,
    *,
    candidate_id: str,
    event_type: str,
    candidate_name: Optional[str] = None,
    job_id: Optional[str] = None,
    job_title: Optional[str] = None,
    actor_email: Optional[str] = None,
    summary: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> Optional[CandidateHistoryEvent]:
    """Append a history event. Best-effort: logs and swallows on failure
    rather than failing the caller's request (secondary write)."""
    event = build_history_event(
        candidate_id=candidate_id,
        event_type=event_type,
        candidate_name=candidate_name,
        job_id=job_id,
        job_title=job_title,
        actor_email=actor_email,
        summary=summary,
        details=details,
    )
    log_history_events(store, [event])
    return event


def get_history(
    store: Store, candidate_id: str, job_id: Optional[str] = None
) -> list[CandidateHistoryEvent]:
    events = [
        event
        for event in store.candidate_history_events.list_for_candidate(candidate_id)
        if job_id is None or event.job_id == str(job_id)
    ]
    return sorted(events, key=lambda e: (e.created_at, e.event_type == "evaluation_updated"), reverse=True)



def derive_focus_areas(
    missing_skills: list[Any], weaknesses: Optional[str]
) -> list[str]:
    focus_areas: list[str] = []
    for skill in missing_skills:
        label = skill.get("skill") if isinstance(skill, dict) else str(skill)
        if not label:
            continue
        focus_areas.append(f"Probe depth on {label} — flagged as a gap in the resume screen")
        if len(focus_areas) >= MAX_FOCUS_AREAS:
            break
    if weaknesses and len(focus_areas) < MAX_FOCUS_AREAS:
        focus_areas.append(f"Follow up on: {weaknesses.strip()[:200]}")
    return focus_areas


def build_briefing(
    *,
    candidate_id: str,
    candidate_name: str,
    candidate_email: Optional[str],
    job_id: Optional[str],
    job_title: Optional[str],
    scorecard: Optional[BriefingScorecard],
    matched_skills: list[Any],
    missing_skills: list[Any],
    strengths: Optional[str],
    weaknesses: Optional[str],
    transferable_skills: Optional[str],
    evidence_highlights: list[Any],
    recruiter_notes: Optional[str],
) -> CandidateBriefing:
    return CandidateBriefing(
        candidate_id=str(candidate_id),
        candidate_name=candidate_name,
        candidate_email=candidate_email,
        job_id=str(job_id) if job_id else None,
        job_title=job_title,
        generated_at=datetime.now(timezone.utc),
        scorecard=scorecard or BriefingScorecard(),
        matched_skills=matched_skills,
        missing_skills=missing_skills,
        strengths=strengths,
        weaknesses=weaknesses,
        transferable_skills=transferable_skills,
        evidence_highlights=evidence_highlights[:8],
        interview_focus_areas=derive_focus_areas(missing_skills, weaknesses),
        recruiter_notes=recruiter_notes,
    )


def _handoff_email(handoff: InterviewHandoff) -> tuple[str, str, str]:
    link = f"{settings.FRONTEND_URL.rstrip('/')}/handoff/{handoff.id}"
    subject = f"Interview briefing — {handoff.candidate_name} ({handoff.job_title or 'open role'})"
    briefing = handoff.briefing or {}
    scorecard = briefing.get("scorecard") or {}
    overall = scorecard.get("overall_score")
    strengths = briefing.get("strengths") or "Not noted"
    focus_areas = briefing.get("interview_focus_areas") or []
    focus_html = "".join(f"<li>{area}</li>" for area in focus_areas) or "<li>No specific gaps flagged.</li>"
    focus_text = "\n".join(f"- {area}" for area in focus_areas) or "- No specific gaps flagged."

    html = f"""
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937;">
      <p>Hi {handoff.interviewer_name},</p>
      <p>You've been handed a candidate briefing for <strong>{handoff.candidate_name}</strong>
      ({handoff.job_title or 'open role'}){f' — overall match score {overall}/100' if overall is not None else ''}.</p>
      <p><strong>Strengths:</strong> {strengths}</p>
      <p><strong>Suggested interview focus:</strong></p>
      <ul>{focus_html}</ul>
      <p><a href="{link}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;
      text-decoration:none;font-weight:600;font-size:13px;">Open full briefing</a></p>
      <p>— ResumeIQ Recruiting</p>
    </div>
    """
    text = (
        f"Hi {handoff.interviewer_name},\n\n"
        f"You've been handed a candidate briefing for {handoff.candidate_name} "
        f"({handoff.job_title or 'open role'}).\n\n"
        f"Strengths: {strengths}\n\n"
        f"Suggested interview focus:\n{focus_text}\n\n"
        f"Full briefing: {link}\n\n"
        f"— ResumeIQ Recruiting"
    )
    return subject, html, text


def create_handoff(
    store: Store, payload: HandoffCreateRequest, recruiter_email: str
) -> InterviewHandoff:
    briefing = build_briefing(
        candidate_id=payload.candidate_id,
        candidate_name=payload.candidate_name,
        candidate_email=payload.candidate_email,
        job_id=payload.job_id,
        job_title=payload.job_title,
        scorecard=payload.scorecard,
        matched_skills=payload.matched_skills,
        missing_skills=payload.missing_skills,
        strengths=payload.strengths,
        weaknesses=payload.weaknesses,
        transferable_skills=payload.transferable_skills,
        evidence_highlights=payload.evidence_highlights,
        recruiter_notes=payload.recruiter_notes,
    )

    handoff = InterviewHandoff(
        candidate_id=payload.candidate_id,
        candidate_name=payload.candidate_name,
        candidate_email=payload.candidate_email,
        job_id=payload.job_id,
        job_title=payload.job_title,
        interviewer_name=payload.interviewer_name,
        interviewer_email=payload.interviewer_email,
        created_by=recruiter_email,
        briefing=briefing.model_dump(mode="json"),
        status="pending",
    )

    subject, html, text = _handoff_email(handoff)
    email_result = email_service.send_email(
        to_email=payload.interviewer_email,
        to_name=payload.interviewer_name,
        subject=subject,
        html_body=html,
        text_body=text,
    )
    handoff.email_sent = email_result.sent
    handoff.email_source = email_result.source

    # Primary domain write — must succeed, propagates on failure.
    store.handoffs.save(handoff)

    log_history_event(
        store,
        candidate_id=payload.candidate_id,
        candidate_name=payload.candidate_name,
        job_id=payload.job_id,
        job_title=payload.job_title,
        event_type="handoff_created",
        actor_email=recruiter_email,
        summary=f"Briefing handed off to {payload.interviewer_name} <{payload.interviewer_email}>",
        details={"handoff_id": str(handoff.id), "email_sent": email_result.sent},
    )

    return handoff


def mark_viewed(store: Store, handoff: InterviewHandoff) -> InterviewHandoff:
    if handoff.status == "pending":
        handoff.status = "viewed"
        handoff.viewed_at = datetime.now(timezone.utc)
        store.handoffs.save(handoff)
        log_history_event(
            store,
            candidate_id=handoff.candidate_id,
            candidate_name=handoff.candidate_name,
            job_id=handoff.job_id,
            job_title=handoff.job_title,
            event_type="handoff_viewed",
            actor_email=handoff.interviewer_email,
            summary=f"{handoff.interviewer_name} opened the briefing",
            details={"handoff_id": str(handoff.id)},
        )
    return handoff


def acknowledge_handoff(
    store: Store, handoff: InterviewHandoff, notes: Optional[str]
) -> InterviewHandoff:
    handoff.status = "acknowledged"
    handoff.acknowledged_at = datetime.now(timezone.utc)
    if notes is not None:
        handoff.interviewer_notes = notes
    store.handoffs.save(handoff)
    log_history_event(
        store,
        candidate_id=handoff.candidate_id,
        candidate_name=handoff.candidate_name,
        job_id=handoff.job_id,
        job_title=handoff.job_title,
        event_type="handoff_acknowledged",
        actor_email=handoff.interviewer_email,
        summary=f"{handoff.interviewer_name} acknowledged the briefing"
        + (" with notes" if notes else ""),
        details={"handoff_id": str(handoff.id)},
    )
    return handoff


def list_handoffs_for_candidate(store: Store, candidate_id: str) -> list[InterviewHandoff]:
    handoffs = store.handoffs.query(lambda h: h.candidate_id == str(candidate_id))
    return sorted(handoffs, key=lambda h: h.created_at, reverse=True)
