import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    resume_file_id: Mapped[Optional[str]] = mapped_column(String(500))
    resume_text: Mapped[Optional[str]] = mapped_column(Text)
    skills: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    experience: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    education: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    certifications: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    projects: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    github_url: Mapped[Optional[str]] = mapped_column(String(255))
    linkedin_url: Mapped[Optional[str]] = mapped_column(String(255))
    portfolio_url: Mapped[Optional[str]] = mapped_column(String(255))
    # Intake path. Nullable so older rows stay valid; default resume_upload because
    # that is the only ingestion path ResumeIQ currently has.
    source: Mapped[Optional[str]] = mapped_column(String(32), default="resume_upload")
    enriched_profile: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), onupdate=func.now()
    )

    evaluations = relationship("Evaluation", back_populates="candidate", cascade="all, delete")

    def years_of_experience(self) -> float:
        total = 0.0
        for item in self.experience or []:
            if isinstance(item, dict) and item.get("years") is not None:
                try:
                    total += float(item["years"])
                except (TypeError, ValueError):
                    continue
        if total > 0:
            return total
        return float(len(self.experience or []))
