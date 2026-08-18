import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


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
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
