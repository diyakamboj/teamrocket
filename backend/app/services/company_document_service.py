"""Ingestion of company context documents.

Upload -> blob storage -> text extraction -> a short AI summary, run in a
background task the same way resume and chat-attachment processing is. The
extracted text is what lets the Copilot answer from company context rather
than guessing, so extraction failures are recorded on the document instead of
being swallowed.

Unlike chat attachments these are never classified or parsed into candidates:
a culture deck that happens to read like a CV must not become a fake
candidate in the pool.
"""

from __future__ import annotations

import uuid

from app.models.company_document import CompanyDocument
from app.services.attachment_processor import extract_attachment_text
from app.services.azure_services import blob_service, openai_service
from app.storage.store import store
from app.utils.logger import get_logger

logger = get_logger(__name__)

SUMMARY_SYSTEM = (
    "You summarise a company's internal context document (vision, values, "
    "culture, or hiring guidelines) for a recruiting assistant. Return JSON "
    '{"summary": str} — three sentences at most, describing what this '
    "document says about how the company works and hires. Do not invent "
    "anything that is not in the text."
)

#: Extracted text kept per document. Enough for grounding, bounded so one
#: large upload cannot dominate a prompt or the stored document.
MAX_EXTRACTED_CHARS = 20_000


def summarize(text: str) -> str:
    """Short description of a company document, or a text preview if the model
    is unavailable — a missing summary must not fail the upload."""
    excerpt = text[:4000]
    if not excerpt.strip():
        return ""
    if openai_service.mock:
        return excerpt[:200]
    result = openai_service.chat_json_or_empty(excerpt, system=SUMMARY_SYSTEM, temperature=0)
    return str(result.get("summary") or excerpt[:200])


def process_document(document_id: uuid.UUID) -> None:
    """Background task: extract text from the stored blob and summarise it."""
    document = store.company_documents.get(document_id)
    if not document or not document.blob_path:
        return

    try:
        document.status = "processing"
        store.company_documents.save(document)

        file_bytes = blob_service.download_bytes(document.blob_path)
        text = extract_attachment_text(file_bytes, document.filename)
        document.extracted_text = (text or "")[:MAX_EXTRACTED_CHARS]
        document.extracted_summary = summarize(document.extracted_text or "")
        document.status = "processed"
        store.company_documents.save(document)
    except Exception as exc:
        logger.exception("Company document processing failed for %s", document_id)
        document = store.company_documents.get(document_id)
        if document:
            document.status = "failed"
            document.error = str(exc)
            store.company_documents.save(document)


def context_for_recruiter(recruiter_email: str, limit: int = 6) -> str:
    """Company context block for Copilot prompts, newest documents first."""
    documents = [
        doc
        for doc in store.company_documents.query(
            lambda d: d.recruiter_email == recruiter_email and d.status == "processed"
        )
        if doc.extracted_summary
    ]
    documents.sort(key=lambda d: d.created_at, reverse=True)
    if not documents:
        return ""
    lines = [f"- [{doc.category}] {doc.filename}: {doc.extracted_summary}" for doc in documents[:limit]]
    return "Company context provided by the recruiter:\n" + "\n".join(lines)
