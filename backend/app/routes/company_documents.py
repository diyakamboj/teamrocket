"""Company context documents API.

Every route is scoped to the recruiter in `X-Recruiter-Email`: a document is
only readable, listable or deletable by the account that uploaded it. The app
has no real auth (a documented limitation — see `model_registry`), so this
header is the identity it has; scoping to it is what stops one recruiter's
uploaded documents being enumerable by another.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile

from app.dependencies import AppStore, RecruiterEmail
from app.models.company_document import COMPANY_DOC_CATEGORIES, CompanyDocument
from app.models.evaluation import AuditLog
from app.services.azure_services import blob_service
from app.services.company_document_service import process_document
from app.utils.error_handlers import NotFoundError, ValidationAppError
from app.utils.logger import get_logger
from app.utils.validators import (
    ALLOWED_COMPANY_DOC_EXTENSIONS,
    MAX_COMPANY_DOC_SIZE_BYTES,
    is_allowed_company_doc_filename,
    safe_upload_filename,
)

router = APIRouter()
logger = get_logger(__name__)


def _audit(store, **fields) -> None:
    try:
        store.audit_logs.save(AuditLog(**fields))
    except Exception as exc:  # an audit failure must not fail the request
        logger.warning("Failed to persist audit log %s: %s", fields.get("action"), exc)


def _owned(store, document_id: uuid.UUID, recruiter_email: str) -> CompanyDocument:
    """Fetch a document, or 404 if it is missing *or* someone else's.

    Answering 404 rather than 403 keeps the ids of other recruiters'
    documents unguessable.
    """
    document = store.company_documents.get(document_id)
    if not document or document.recruiter_email != recruiter_email:
        raise NotFoundError("Company document not found", {"document_id": str(document_id)})
    return document


@router.get("", response_model=list[CompanyDocument])
def list_documents(store: AppStore, recruiter_email: RecruiterEmail):
    """This recruiter's documents, newest first."""
    documents = store.company_documents.query(lambda d: d.recruiter_email == recruiter_email)
    return sorted(documents, key=lambda d: d.created_at, reverse=True)


@router.post("", response_model=CompanyDocument, status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    store: AppStore,
    recruiter_email: RecruiterEmail,
    file: UploadFile = File(...),
    category: str = Form("values"),
):
    if category not in COMPANY_DOC_CATEGORIES:
        raise ValidationAppError(
            "Unknown document category", {"allowed": list(COMPANY_DOC_CATEGORIES)}
        )

    filename = safe_upload_filename(file.filename or "document")
    if not is_allowed_company_doc_filename(filename):
        raise ValidationAppError(
            "Unsupported file type",
            {"allowed": sorted(ALLOWED_COMPANY_DOC_EXTENSIONS)},
        )

    content = await file.read()
    if not content:
        raise ValidationAppError("File is empty")
    if len(content) > MAX_COMPANY_DOC_SIZE_BYTES:
        raise ValidationAppError(
            "File exceeds the 10MB limit",
            {"max_bytes": MAX_COMPANY_DOC_SIZE_BYTES},
        )

    blob_path = blob_service.upload_bytes(
        content,
        filename,
        # The browser-declared content type is not trusted for storage; the
        # extension has already been validated against the allowlist.
        content_type="application/octet-stream",
        prefix="company-documents",
    )

    document = CompanyDocument(
        recruiter_email=recruiter_email,
        category=category,
        filename=filename,
        blob_path=blob_path,
        content_type=file.content_type,
        size_bytes=len(content),
        status="queued",
    )
    store.company_documents.save(document)
    background_tasks.add_task(process_document, document.id)

    _audit(
        store,
        recruiter_email=recruiter_email,
        action="company_document_upload",
        resource_type="company_document",
        resource_id=document.id,
        details={"filename": filename, "category": category, "size_bytes": len(content)},
    )
    return document


@router.get("/{document_id}", response_model=CompanyDocument)
def get_document(document_id: uuid.UUID, store: AppStore, recruiter_email: RecruiterEmail):
    return _owned(store, document_id, recruiter_email)


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: uuid.UUID, store: AppStore, recruiter_email: RecruiterEmail):
    document = _owned(store, document_id, recruiter_email)
    if document.blob_path:
        try:
            blob_service.delete_blob(document.blob_path)
        except Exception as exc:
            # The record still goes; a stranded blob is preferable to a
            # document the recruiter cannot remove from their list.
            logger.warning("Could not delete blob %s: %s", document.blob_path, exc)
    store.company_documents.delete(document_id)

    _audit(
        store,
        recruiter_email=recruiter_email,
        action="company_document_delete",
        resource_type="company_document",
        resource_id=document_id,
        details={"filename": document.filename},
    )
    return None
