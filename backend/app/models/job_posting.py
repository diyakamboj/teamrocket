import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, Integer, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


class JobPosting(Base):
    __tablename__ = "job_postings"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    required_skills: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    required_experience_years: Mapped[Optional[int]] = mapped_column(Integer)
    education_requirements: Mapped[Optional[str]] = mapped_column(String(255))
    nice_to_have_skills: Mapped[Optional[list[Any]]] = mapped_column(JSONType, default=list)
    created_by: Mapped[Optional[str]] = mapped_column(String(255), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now(), onupdate=func.now()
    )

    evaluations = relationship("Evaluation", back_populates="job", cascade="all, delete")
