"""Scheduling Service for Interview Lifecycle Management.

Coordinates interview proposal creation, slot confirmation, Teams link generation,
calendar invitation sending, rescheduling, and cancellation.
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Optional

from app.models.interview import InterviewProposal, ScheduledInterview, TimeSlot
from app.models.evaluation import AuditLog
from app.services import calendar_service, handoff_service
from app.services.email_service import email_service
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError, ValidationAppError
from app.utils.logger import get_logger

logger = get_logger(__name__)


class SchedulingService:
    def propose_interview(
        self,
        store: Store,
        *,
        candidate_id: uuid.UUID,
        recruiter_email: str,
        job_id: Optional[uuid.UUID] = None,
        interview_type: str = "Technical Interview",
        duration_minutes: int = 45,
        required_interviewers: Optional[list[str]] = None,
        notes: Optional[str] = None,
    ) -> InterviewProposal:
        """Finds suitable slots and returns an InterviewProposal for recruiter review."""
        candidate = store.candidates.get(candidate_id)
        if not candidate:
            raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

        job_title = "Technical Role"
        if job_id:
            job = store.jobs.get(job_id)
            if job:
                job_title = job.title
        elif candidate.title:
            job_title = candidate.title

        interviewers = required_interviewers or ["Alex Chen", "Priya Sharma"]

        proposed_slots = calendar_service.find_available_slots(
            required_interviewers=interviewers,
            duration_minutes=duration_minutes,
            candidate_name=candidate.name,
            job_title=job_title,
        )

        proposal = InterviewProposal(
            candidate_id=str(candidate_id),
            candidate_name=candidate.name,
            candidate_email=candidate.email,
            job_id=str(job_id) if job_id else None,
            job_title=job_title,
            interview_type=interview_type,
            duration_minutes=duration_minutes,
            required_interviewers=interviewers,
            proposed_slots=proposed_slots,
            notes=notes,
        )

        return proposal

    def confirm_interview(
        self,
        store: Store,
        *,
        candidate_id: uuid.UUID,
        recruiter_email: str,
        start_time: datetime,
        end_time: datetime,
        interviewers: list[str],
        interview_type: str = "Technical Interview",
        duration_minutes: int = 45,
        job_id: Optional[uuid.UUID] = None,
        notes: Optional[str] = None,
        proposal_id: Optional[str] = None,
    ) -> ScheduledInterview:
        """Confirms slot selection, generates Teams meeting credentials, creates ScheduledInterview record,
        sends calendar invites & notifications, and logs history event."""
        candidate = store.candidates.get(candidate_id)
        if not candidate:
            raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

        job_title = "Technical Role"
        if job_id:
            job = store.jobs.get(job_id)
            if job:
                job_title = job.title
        elif candidate.title:
            job_title = candidate.title

        # Generate Teams meeting details
        subject = f"{interview_type}: {candidate.name} ({job_title})"
        teams_data = calendar_service.generate_teams_meeting(
            subject=subject,
            start_time=start_time,
            end_time=end_time,
            organizer_email=recruiter_email,
        )

        description = (
            f"{interview_type} for {candidate.name} for the {job_title} role.\n\n"
            f"Participants: {', '.join(interviewers)}\n"
            f"Recruiter Contact: {recruiter_email}\n"
            f"Teams Join Link: {teams_data['teams_link']}\n"
            f"Meeting ID: {teams_data['teams_meeting_id']} | Passcode: {teams_data['teams_passcode']}\n\n"
            f"Notes/Agenda: {notes or 'Technical interview & portfolio review.'}"
        )

        deeplink = calendar_service.build_outlook_deeplink(
            subject=subject,
            body=description,
            start_time=start_time,
            end_time=end_time,
            location=teams_data["location"],
        )

        scheduled = ScheduledInterview(
            proposal_id=proposal_id,
            candidate_id=candidate_id,
            candidate_name=candidate.name,
            candidate_email=candidate.email,
            job_id=job_id,
            job_title=job_title,
            recruiter_email=recruiter_email,
            interviewers=interviewers,
            interview_type=interview_type,
            duration_minutes=duration_minutes,
            status="confirmed",
            start_time=start_time,
            end_time=end_time,
            teams_link=teams_data["teams_link"],
            teams_meeting_id=teams_data["teams_meeting_id"],
            teams_passcode=teams_data["teams_passcode"],
            location=teams_data["location"],
            notes=notes,
            outlook_deeplink=deeplink,
        )

        store.interviews.save(scheduled)

        # Log history event & audit log
        handoff_service.log_history_event(
            store,
            candidate_id=str(candidate_id),
            event_type="interview_scheduled",
            candidate_name=candidate.name,
            job_id=str(job_id) if job_id else None,
            job_title=job_title,
            actor_email=recruiter_email,
            summary=f"Scheduled {interview_type} with {', '.join(interviewers)} on {start_time.strftime('%b %d at %H:%M')}",
            details={
                "interview_id": str(scheduled.id),
                "teams_link": teams_data["teams_link"],
                "interviewers": interviewers,
                "duration_minutes": duration_minutes,
            },
        )

        try:
            store.audit_logs.save(
                AuditLog(
                    recruiter_email=recruiter_email,
                    action="schedule_interview",
                    resource_type="interview",
                    resource_id=scheduled.id,
                    details={
                        "candidate_id": str(candidate_id),
                        "interviewers": interviewers,
                        "start_time": start_time.isoformat(),
                    },
                )
            )
        except Exception as exc:
            logger.warning("Audit log error: %s", exc)

        # Trigger notification email (mock or live)
        email_service.send(
            to_email=candidate.email or recruiter_email,
            subject=f"Interview Scheduled: {interview_type} - {job_title}",
            body_text=description,
        )

        return scheduled

    def reschedule_propose(
        self,
        store: Store,
        interview_id: uuid.UUID,
        recruiter_email: str,
    ) -> InterviewProposal:
        """Finds new available slots to reschedule an existing interview."""
        interview = store.interviews.get(interview_id)
        if not interview:
            raise NotFoundError("Scheduled interview not found", {"interview_id": str(interview_id)})

        return self.propose_interview(
            store,
            candidate_id=interview.candidate_id,
            recruiter_email=recruiter_email,
            job_id=interview.job_id,
            interview_type=interview.interview_type,
            duration_minutes=interview.duration_minutes,
            required_interviewers=interview.interviewers,
            notes=f"Reschedule request for interview {interview.id}",
        )

    def confirm_reschedule(
        self,
        store: Store,
        interview_id: uuid.UUID,
        recruiter_email: str,
        start_time: datetime,
        end_time: datetime,
    ) -> ScheduledInterview:
        """Updates existing interview with new time and fresh Teams link."""
        interview = store.interviews.get(interview_id)
        if not interview:
            raise NotFoundError("Scheduled interview not found", {"interview_id": str(interview_id)})

        subject = f"[Rescheduled] {interview.interview_type}: {interview.candidate_name} ({interview.job_title})"
        teams_data = calendar_service.generate_teams_meeting(
            subject=subject,
            start_time=start_time,
            end_time=end_time,
            organizer_email=recruiter_email,
        )

        interview.start_time = start_time
        interview.end_time = end_time
        interview.status = "rescheduled"
        interview.teams_link = teams_data["teams_link"]
        interview.teams_meeting_id = teams_data["teams_meeting_id"]
        interview.teams_passcode = teams_data["teams_passcode"]
        interview.updated_at = datetime.now(timezone.utc)

        store.interviews.save(interview)

        # Log history event
        handoff_service.log_history_event(
            store,
            candidate_id=str(interview.candidate_id),
            event_type="interview_rescheduled",
            candidate_name=interview.candidate_name,
            job_id=str(interview.job_id) if interview.job_id else None,
            job_title=interview.job_title,
            actor_email=recruiter_email,
            summary=f"Rescheduled interview to {start_time.strftime('%b %d at %H:%M')}",
            details={"interview_id": str(interview.id), "new_start": start_time.isoformat()},
        )

        return interview

    def cancel_interview(
        self,
        store: Store,
        interview_id: uuid.UUID,
        recruiter_email: str,
        reason: Optional[str] = None,
    ) -> ScheduledInterview:
        """Cancels a scheduled interview and notifies participants."""
        interview = store.interviews.get(interview_id)
        if not interview:
            raise NotFoundError("Scheduled interview not found", {"interview_id": str(interview_id)})

        interview.status = "cancelled"
        interview.updated_at = datetime.now(timezone.utc)
        if reason:
            interview.notes = f"Cancellation Reason: {reason} | {interview.notes or ''}"

        store.interviews.save(interview)

        handoff_service.log_history_event(
            store,
            candidate_id=str(interview.candidate_id),
            event_type="interview_cancelled",
            candidate_name=interview.candidate_name,
            job_id=str(interview.job_id) if interview.job_id else None,
            job_title=interview.job_title,
            actor_email=recruiter_email,
            summary=f"Cancelled interview ({reason or 'No reason provided'})",
            details={"interview_id": str(interview.id), "reason": reason},
        )

        return interview

    def get_candidate_interviews(
        self,
        store: Store,
        candidate_id: uuid.UUID,
    ) -> list[ScheduledInterview]:
        """Retrieves all scheduled/past interviews for candidate."""
        interviews = store.interviews.query(
            lambda i: i.candidate_id == candidate_id
        )
        return sorted(interviews, key=lambda i: i.created_at, reverse=True)


scheduling_service = SchedulingService()
