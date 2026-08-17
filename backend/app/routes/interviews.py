from datetime import datetime
import uuid
from typing import Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Query

from app.dependencies import AppStore, RecruiterEmail
from app.models.interview import InterviewProposal, ScheduledInterview, TimeSlot
from app.services.calendar_service import list_known_interviewers
from app.services.scheduling_service import scheduling_service
from app.utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


class ProposeInterviewRequest(BaseModel):
    candidate_id: uuid.UUID
    job_id: Optional[uuid.UUID] = None
    interview_type: str = "Technical Interview"
    duration_minutes: int = 45
    required_interviewers: Optional[list[str]] = Field(
        default_factory=lambda: ["Alex Chen", "Priya Sharma"]
    )
    notes: Optional[str] = None


class ConfirmInterviewRequest(BaseModel):
    proposal_id: Optional[str] = None
    candidate_id: uuid.UUID
    job_id: Optional[uuid.UUID] = None
    interview_type: str = "Technical Interview"
    duration_minutes: int = 45
    interviewers: list[str]
    start_time: datetime
    end_time: datetime
    notes: Optional[str] = None


class RescheduleConfirmRequest(BaseModel):
    start_time: datetime
    end_time: datetime


class CancelInterviewRequest(BaseModel):
    reason: Optional[str] = None


@router.get("/interviewers")
def get_interviewers():
    """List available internal interviewers for scheduling."""
    return list_known_interviewers()


@router.post("/propose", response_model=InterviewProposal)
def propose_interview(
    payload: ProposeInterviewRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Find available slots and return an interview proposal for recruiter approval."""
    return scheduling_service.propose_interview(
        store,
        candidate_id=payload.candidate_id,
        recruiter_email=recruiter_email,
        job_id=payload.job_id,
        interview_type=payload.interview_type,
        duration_minutes=payload.duration_minutes,
        required_interviewers=payload.required_interviewers,
        notes=payload.notes,
    )


@router.post("/confirm", response_model=ScheduledInterview)
def confirm_interview(
    payload: ConfirmInterviewRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Confirm a proposed slot, generate Teams link, create calendar invite, and notify participants."""
    return scheduling_service.confirm_interview(
        store,
        candidate_id=payload.candidate_id,
        recruiter_email=recruiter_email,
        start_time=payload.start_time,
        end_time=payload.end_time,
        interviewers=payload.interviewers,
        interview_type=payload.interview_type,
        duration_minutes=payload.duration_minutes,
        job_id=payload.job_id,
        notes=payload.notes,
        proposal_id=payload.proposal_id,
    )


@router.get("/candidate/{candidate_id}", response_model=list[ScheduledInterview])
def list_candidate_interviews(
    candidate_id: uuid.UUID,
    store: AppStore,
):
    """List all scheduled, past, or cancelled interviews for a candidate."""
    return scheduling_service.get_candidate_interviews(store, candidate_id=candidate_id)


@router.post("/{interview_id}/reschedule-propose", response_model=InterviewProposal)
def reschedule_propose(
    interview_id: uuid.UUID,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Propose new available slots to reschedule an existing interview."""
    return scheduling_service.reschedule_propose(
        store,
        interview_id=interview_id,
        recruiter_email=recruiter_email,
    )


@router.post("/{interview_id}/reschedule-confirm", response_model=ScheduledInterview)
def reschedule_confirm(
    interview_id: uuid.UUID,
    payload: RescheduleConfirmRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Confirm a new slot for an interview, updating calendar event & Teams link."""
    return scheduling_service.confirm_reschedule(
        store,
        interview_id=interview_id,
        recruiter_email=recruiter_email,
        start_time=payload.start_time,
        end_time=payload.end_time,
    )


@router.post("/{interview_id}/cancel", response_model=ScheduledInterview)
def cancel_interview(
    interview_id: uuid.UUID,
    payload: CancelInterviewRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Cancel a scheduled interview and send cancellation notifications."""
    return scheduling_service.cancel_interview(
        store,
        interview_id=interview_id,
        recruiter_email=recruiter_email,
        reason=payload.reason,
    )
