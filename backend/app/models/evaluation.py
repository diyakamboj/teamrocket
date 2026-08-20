import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Evaluation(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    candidate_id: uuid.UUID
    job_id: uuid.UUID
    overall_score: Optional[Decimal] = None
    skill_match_score: Optional[Decimal] = None
    experience_match_score: Optional[Decimal] = None
    education_match_score: Optional[Decimal] = None
    certification_match_score: Optional[Decimal] = None
    project_match_score: Optional[Decimal] = None
    matched_skills: list[Any] = Field(default_factory=list)
    missing_skills: list[Any] = Field(default_factory=list)
    strengths: Optional[str] = None
    weaknesses: Optional[str] = None
    transferable_skills: Optional[str] = None
    blind_review_mode: bool = False
    created_at: datetime = Field(default_factory=_utcnow)


class Evidence(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    evaluation_id: uuid.UUID
    skill_name: Optional[str] = None
    resume_text_snippet: Optional[str] = None
    source_section: Optional[str] = None
    confidence_score: Optional[Decimal] = None
    dimension: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)


class AuditLog(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    recruiter_email: Optional[str] = None
    action: Optional[str] = None
    resource_type: Optional[str] = None
    resource_id: Optional[uuid.UUID] = None
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=_utcnow)


class CandidateDecision(BaseModel):
    """Approve/reject decisions from the Candidate Ranking page.

    candidate_id is a plain string (not a foreign key) because the ranking
    page can show candidates that only exist client-side (demo/mock data),
    not just candidates persisted in the store.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    candidate_id: str
    candidate_name: str
    candidate_email: str
    job_title: Optional[str] = None
    decision: str  # "approved" | "rejected"
    recruiter_email: Optional[str] = None
    email_sent: bool = False
    email_source: Optional[str] = None  # "live" | "mock"
    email_error: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)


class AgentSession(BaseModel):
    """Chat history for the recruiter AI copilot."""

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    recruiter_email: Optional[str] = None
    job_id: Optional[uuid.UUID] = None
    messages: list[Any] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
    candidate_id: Optional[uuid.UUID] = None
    candidate_name: Optional[str] = None
    title: Optional[str] = None


class ChatAttachment(BaseModel):
    """A file attached to a copilot chat session (resume, JD, notes, ...).

    Same shape/field style as `ResumeUpload`, processed by a background task
    that mirrors `resumes.py::_process_resume`'s module-level-`store`
    pattern (see `app/services/attachment_processor.py`).
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    session_id: Optional[uuid.UUID] = None
    recruiter_email: Optional[str] = None
    filename: str
    blob_path: Optional[str] = None
    content_type: Optional[str] = None
    size_bytes: int = 0
    status: str = "queued"  # "queued" | "processing" | "processed" | "failed"
    kind: Optional[str] = None  # "resume" | "job_description" | "notes" | "unknown"
    extracted_text: Optional[str] = None
    extracted_summary: Optional[str] = None
    candidate_id: Optional[uuid.UUID] = None
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)


class ResumeUpload(BaseModel):
    """Tracks bulk resume upload processing status."""

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    #: Who uploaded it — the background task needs this to file the resulting
    #: candidate under the right recruiter.
    recruiter_email: Optional[str] = None
    #: The role this batch was uploaded against, carried through to the
    #: candidate so the résumé lands on that job's board and no other.
    job_id: Optional[uuid.UUID] = None
    #: 'internal' (existing employee) or 'external' (outside applicant),
    #: chosen at intake so the two populations never mix by default.
    source: str = "external"
    #: Internal intake only: where this person sits today, captured at
    #: upload because a résumé states past roles, not the current one.
    current_position: Optional[str] = None
    current_role_duties: Optional[str] = None
    filename: str
    #: SHA-256 of the uploaded bytes. Identity by content, so the same résumé
    #: re-exported under a different filename is still recognised.
    content_sha256: Optional[str] = None
    blob_path: Optional[str] = None
    status: str = "queued"
    progress: int = 0
    error: Optional[str] = None
    candidate_id: Optional[uuid.UUID] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
