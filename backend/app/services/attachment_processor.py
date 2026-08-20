"""Chat-attachment processing: OCR/classify/summarize, and — when the
attachment turns out to be a resume — upsert a real `Candidate` from it.

Reuses the existing OCR pipeline (`doc_intelligence_service.extract_text`)
and `resume_parser` as-is. `_process_attachment` is a `BackgroundTasks` job
that mirrors `app/routes/resumes.py::_process_resume`'s exact
module-level-`store`-singleton pattern: background tasks run outside the
request/response cycle (and outside FastAPI's dependency-injection scope),
so it can't use the per-request `AppStore` dependency.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any, Optional

from app.models.candidate import Candidate
from app.services.azure_services import blob_service, doc_intelligence_service, openai_service
from app.services.resume_parser import resume_parser
from app.services.vector_store import index_candidate
from app.storage.store import Store, store
from app.utils.logger import get_logger
from app.utils.validators import is_valid_email

logger = get_logger(__name__)

ATTACHMENT_KINDS = ("resume", "job_description", "notes", "unknown")

CLASSIFY_SYSTEM = (
    "Classify this document as one of: resume, job_description, notes, unknown. "
    'Return valid JSON: {"kind": "<one of the four>", "summary": "<one sentence>"}.'
)


def extract_attachment_text(file_bytes: bytes, filename: str) -> str:
    return doc_intelligence_service.extract_text(file_bytes, filename)


def classify_and_summarize(text: str) -> dict[str, Any]:
    if openai_service.mock:
        return {"kind": "unknown", "summary": text[:140]}
    result = openai_service.chat_json_or_empty(text[:4000], system=CLASSIFY_SYSTEM, temperature=0)
    kind = str(result.get("kind") or "unknown")
    if kind not in ATTACHMENT_KINDS:
        kind = "unknown"
    summary = str(result.get("summary") or text[:140])
    return {"kind": kind, "summary": summary}


def _title_from_parsed(parsed: dict[str, Any]) -> Optional[str]:
    """Current role title, taken from the most recent parsed experience entry."""
    for entry in parsed.get("experience") or []:
        if isinstance(entry, dict) and entry.get("title"):
            return str(entry["title"])
    return None


def upsert_candidate_from_parsed(
    active_store: Store,
    parsed: dict[str, Any],
    text: str,
    blob_path: Optional[str],
    owner_email: Optional[str] = None,
    job_id: Optional[uuid.UUID] = None,
    source: str = "external",
    current_position: Optional[str] = None,
    current_role_duties: Optional[str] = None,
) -> Candidate:
    """Create-or-update a `Candidate` from a parsed resume (email-dedup
    upsert). Extracted from `resumes.py::_process_resume`'s original
    upsert body so resume upload and chat-attached resumes share one
    implementation instead of two.
    """
    email = parsed.get("email")
    if not email or not is_valid_email(email):
        email = f"candidate.{uuid.uuid4().hex[:10]}@example.com"
        parsed["email"] = email

    # Dedup within the owner's own pool: two recruiters may each hold the
    # same person, and neither should overwrite the other's copy.
    existing = next(
        (
            c
            for c in active_store.candidates.list_all()
            if c.email == email and (owner_email is None or c.owner_email == owner_email)
        ),
        None,
    )
    if existing:
        candidate = existing
        candidate.name = parsed.get("name") or candidate.name
        candidate.phone = parsed.get("phone") or candidate.phone
        candidate.location = parsed.get("location") or candidate.location
        candidate.title = _title_from_parsed(parsed) or candidate.title
        candidate.resume_file_id = blob_path or candidate.resume_file_id
        candidate.resume_text = text
        candidate.skills = parsed.get("skills") or candidate.skills
        candidate.experience = parsed.get("experience") or candidate.experience
        candidate.education = parsed.get("education") or candidate.education
        candidate.certifications = parsed.get("certifications") or candidate.certifications
        candidate.projects = parsed.get("projects") or candidate.projects
        candidate.github_url = parsed.get("github_url") or candidate.github_url
        candidate.linkedin_url = parsed.get("linkedin_url") or candidate.linkedin_url
        candidate.portfolio_url = parsed.get("portfolio_url") or candidate.portfolio_url
        # Re-uploading someone's résumé against a role is how a recruiter
        # says "consider them for this too". Their original job is kept if
        # this upload named none.
        if job_id is not None:
            candidate.job_id = job_id
        if current_position:
            candidate.current_assignment = current_position
        if current_role_duties:
            candidate.current_role_duties = current_role_duties
    else:
        candidate = Candidate(
            owner_email=owner_email,
            job_id=job_id,
            source=source,
            # An internal hire is an employee, so they start assigned rather
            # than with no employment state at all.
            employment_status="assigned" if source == "internal" else None,
            current_assignment=current_position,
            current_role_duties=current_role_duties,
            name=parsed.get("name") or "Unknown",
            email=email,
            phone=parsed.get("phone"),
            location=parsed.get("location"),
            title=_title_from_parsed(parsed),
            resume_file_id=blob_path,
            resume_text=text,
            skills=parsed.get("skills") or [],
            experience=parsed.get("experience") or [],
            education=parsed.get("education") or [],
            certifications=parsed.get("certifications") or [],
            projects=parsed.get("projects") or [],
            github_url=parsed.get("github_url"),
            linkedin_url=parsed.get("linkedin_url"),
            portfolio_url=parsed.get("portfolio_url"),
        )
    active_store.candidates.save(candidate)

    # Index for semantic search. Best-effort: a candidate that cannot be
    # embedded is still a candidate, just not retrievable by similarity.
    try:
        index_candidate(candidate)
    except Exception as exc:
        logger.warning("Could not index candidate %s for search: %s", candidate.id, exc)
    return candidate


def _process_attachment(attachment_id: uuid.UUID) -> None:
    attachment = store.chat_attachments.get(attachment_id)
    if not attachment or not attachment.blob_path:
        return

    try:
        attachment.status = "processing"
        store.chat_attachments.save(attachment)

        file_bytes = blob_service.download_bytes(attachment.blob_path)
        text = extract_attachment_text(file_bytes, attachment.filename)
        attachment.extracted_text = text

        classification = classify_and_summarize(text)
        attachment.kind = classification["kind"]
        attachment.extracted_summary = classification["summary"]

        if attachment.kind == "resume":
            parsed = asyncio.run(resume_parser.parse_resume(text))
            candidate = upsert_candidate_from_parsed(
                store, parsed, text, attachment.blob_path, owner_email=attachment.recruiter_email
            )
            attachment.candidate_id = candidate.id

        attachment.status = "processed"
        store.chat_attachments.save(attachment)
    except Exception as exc:
        logger.exception("Attachment processing failed for %s", attachment_id)
        attachment = store.chat_attachments.get(attachment_id)
        if attachment:
            attachment.status = "failed"
            attachment.error = str(exc)
            store.chat_attachments.save(attachment)
