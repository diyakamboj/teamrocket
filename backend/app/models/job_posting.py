import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class InterviewRound(BaseModel):
    """One stage of a job's interview loop, defined when the job is set up.

    Rounds are per job rather than global: a staff role and an intern role do
    not run the same loop, and the pipeline board is only meaningful if its
    columns match the process the recruiter actually runs.
    """

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    #: Order in the loop, 1-based. The board renders columns by this.
    sequence: int = 1
    #: What this round is for, shown to the interviewer on the handoff.
    focus: Optional[str] = None
    interview_type: str = "Technical Interview"
    duration_minutes: int = 45
    #: Who runs this round. A hiring manager looking at the board needs to
    #: see what is queued for *them* without opening every candidate.
    interviewer_name: Optional[str] = None
    interviewer_email: Optional[str] = None


#: Used when a job is created without its own loop, so the board is never
#: empty and the recruiter has something to edit rather than invent.
DEFAULT_ROUNDS: list[dict[str, Any]] = [
    {"name": "Recruiter screen", "sequence": 1, "focus": "Motivation, logistics, comp", "interview_type": "Recruiter Screen", "duration_minutes": 30},
    {"name": "Technical interview", "sequence": 2, "focus": "Depth in the core stack", "interview_type": "Technical Interview", "duration_minutes": 60},
    {"name": "System design", "sequence": 3, "focus": "Design judgement and trade-offs", "interview_type": "System Design", "duration_minutes": 60},
    {"name": "Hiring manager", "sequence": 4, "focus": "Ownership, collaboration, fit", "interview_type": "Hiring Manager", "duration_minutes": 45},
]


class ScoringWeights(BaseModel):
    """How this role ranks candidates, as percentages.

    Same five knobs as Settings → Scoring defaults. Stored per job so a
    staff-engineer search can weigh skills more heavily than an intern role
    without changing the recruiter's global defaults.
    """

    skills: int = 40
    experience: int = 25
    education: int = 15
    certifications: int = 10
    projects: int = 10


class JobPosting(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    title: str
    description: str
    required_skills: list[Any] = Field(default_factory=list)
    required_experience_years: Optional[int] = None
    education_requirements: Optional[str] = None
    nice_to_have_skills: list[Any] = Field(default_factory=list)
    # "open" | "paused" | "closed" — drives the "active job listings" dashboard filter.
    status: str = "open"
    # "internal" | "external" | "both" — advisory/display only, never gates matching.
    sourcing_mode: str = "both"
    #: The interview loop for this role, in order.
    rounds: list[InterviewRound] = Field(default_factory=list)
    scoring_weights: ScoringWeights = Field(default_factory=ScoringWeights)
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
