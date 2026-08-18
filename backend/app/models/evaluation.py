import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


class Evaluation(Base):
    __tablename__ = "evaluations"
    __table_args__ = (UniqueConstraint("candidate_id", "job_id", name="uq_evaluation_candidate_job"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("candidates.id"), nullable=False, index=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_postings.id"), nullable=False, index=True
    )
    overall_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    skill_match_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    experience_match_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    education_match_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    certification_match_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    project_match_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    technical_skills_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    communication_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    role_alignment_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2))
    matched_skills: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    missing_skills: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    strengths: Mapped[Optional[str]] = mapped_column(Text)
    weaknesses: Mapped[Optional[str]] = mapped_column(Text)
    transferable_skills: Mapped[Optional[str]] = mapped_column(Text)
    blind_review_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    # Hiring-process stage (not a score bucket). ResumeIQ currently only auto-tracks
    # screening, so new evaluations default to "screened".
    pipeline_stage: Mapped[Optional[str]] = mapped_column(String(32), default="screened")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )

    candidate = relationship("Candidate", back_populates="evaluations")
    job = relationship("JobPosting", back_populates="evaluations")
    evidence_items = relationship(
        "Evidence", back_populates="evaluation", cascade="all, delete-orphan"
    )


class Evidence(Base):
    __tablename__ = "evidence"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    evaluation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("evaluations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    skill_name: Mapped[Optional[str]] = mapped_column(String(255))
    resume_text_snippet: Mapped[Optional[str]] = mapped_column(Text)
    source_section: Mapped[Optional[str]] = mapped_column(String(100))
    confidence_score: Mapped[Optional[Decimal]] = mapped_column(Numeric(3, 2))
    dimension: Mapped[Optional[str]] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )

    evaluation = relationship("Evaluation", back_populates="evidence_items")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    recruiter_email: Mapped[Optional[str]] = mapped_column(String(255))
    action: Mapped[Optional[str]] = mapped_column(String(100))
    resource_type: Mapped[Optional[str]] = mapped_column(String(100))
    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid)
    details: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )


class CandidateDecision(Base):
    """Approve/reject decisions from the Candidate Ranking page.

    candidate_id is a plain string (not an FK) because the ranking page can
    show candidates that only exist client-side (demo/mock data), not just
    rows in the candidates table.
    """

    __tablename__ = "candidate_decisions"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    candidate_id: Mapped[str] = mapped_column(String(255), index=True)
    candidate_name: Mapped[str] = mapped_column(String(255))
    candidate_email: Mapped[str] = mapped_column(String(255))
    job_title: Mapped[Optional[str]] = mapped_column(String(255))
    decision: Mapped[str] = mapped_column(String(20))  # "approved" | "rejected"
    recruiter_email: Mapped[Optional[str]] = mapped_column(String(255))
    email_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    email_source: Mapped[Optional[str]] = mapped_column(String(20))  # "live" | "mock"
    email_error: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )


class AgentSession(Base):
    """Chat history for the recruiter AI copilot."""

    __tablename__ = "agent_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    recruiter_email: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    job_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid, index=True)
    messages: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), onupdate=func.now()
    )


class ResumeUpload(Base):
    """Tracks bulk resume upload processing status."""

    __tablename__ = "resume_uploads"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    blob_path: Mapped[Optional[str]] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(50), default="queued", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[Optional[str]] = mapped_column(Text)
    candidate_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid, ForeignKey("candidates.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), onupdate=func.now()
    )
