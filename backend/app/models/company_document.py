"""Company context documents — vision, values, culture, hiring guidelines.

Deliberately its own entity rather than a reuse of `ChatAttachment`: chat
attachments are classified and a resume-looking one is parsed into a
Candidate, which is exactly wrong for a culture deck. These are never parsed
into candidates, are always scoped to the recruiter who uploaded them, and
keep the extracted text so the Copilot can ground answers in company context.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


#: Categories the Settings page offers. Anything else is rejected at the API
#: boundary rather than stored as free text.
COMPANY_DOC_CATEGORIES = ("vision", "values", "culture", "guidelines")


class CompanyDocument(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    recruiter_email: str
    category: str = "values"
    filename: str
    blob_path: Optional[str] = None
    content_type: Optional[str] = None
    size_bytes: int = 0
    status: str = "queued"  # "queued" | "processing" | "processed" | "failed"
    extracted_text: Optional[str] = None
    extracted_summary: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
