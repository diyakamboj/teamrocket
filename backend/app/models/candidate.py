import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Candidate(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    #: Recruiter this candidate belongs to. Set from the uploading account, so
    #: one recruiter's pool is not visible to another. Records created before
    #: ownership existed have None and belong to nobody — see
    #: `scripts/assign_legacy_owner.py` to claim them.
    owner_email: Optional[str] = None
    name: str
    email: str
    phone: Optional[str] = None
    location: Optional[str] = None
    title: Optional[str] = None
    resume_file_id: Optional[str] = None
    resume_text: Optional[str] = None
    skills: list[Any] = Field(default_factory=list)
    experience: list[Any] = Field(default_factory=list)
    education: list[Any] = Field(default_factory=list)
    certifications: list[Any] = Field(default_factory=list)
    projects: list[Any] = Field(default_factory=list)
    github_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    hackerrank_url: Optional[str] = None
    enriched_profile: Optional[dict[str, Any]] = Field(default_factory=dict)

    # "internal" (existing employee applying/referred) vs "external" (outside applicant).
    source: str = "external"
    employment_status: Optional[str] = None   # "bench" | "assigned" | None — only meaningful when source == "internal"
    current_assignment: Optional[str] = None  # free-text project/team; blank when on bench
    bench_since: Optional[datetime] = None    # when they became available
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)

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
