from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Literal, Optional
from pydantic import BaseModel, Field


class TimeSlot(BaseModel):
    slot_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    start_time: datetime
    end_time: datetime
    label: str
    available_interviewers: list[str]
    is_recommended: bool = False
    outlook_url: Optional[str] = None


class InterviewerAvailability(BaseModel):
    name: str
    email: str
    title: str
    busy_slots: list[dict[str, str]] = Field(default_factory=list)  # ISO start and end strings


class InterviewProposal(BaseModel):
    proposal_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    candidate_id: str
    candidate_name: str
    candidate_email: Optional[str] = None
    job_id: Optional[str] = None
    job_title: Optional[str] = None
    interview_type: str = "Technical Interview"  # e.g., Technical Interview, Recruiter Screen, System Design, Hiring Manager
    duration_minutes: int = 45
    required_interviewers: list[str]  # e.g. ["Alex Chen", "Priya Sharma"]
    proposed_slots: list[TimeSlot] = Field(default_factory=list)
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ScheduledInterview(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    proposal_id: Optional[str] = None
    candidate_id: uuid.UUID
    candidate_name: str
    candidate_email: Optional[str] = None
    job_id: Optional[uuid.UUID] = None
    job_title: Optional[str] = None
    recruiter_email: str
    interviewers: list[str]  # ["Alex Chen", "Priya Sharma"]
    interview_type: str = "Technical Interview"
    duration_minutes: int = 45
    status: Literal["proposed", "confirmed", "rescheduled", "cancelled"] = "confirmed"
    start_time: datetime
    end_time: datetime
    teams_link: str
    teams_meeting_id: str
    teams_passcode: str
    location: str = "Microsoft Teams Meeting"
    notes: Optional[str] = None
    ics_url: Optional[str] = None
    outlook_deeplink: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
