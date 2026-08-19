import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, UploadFile

from app.config import settings
from app.dependencies import AppStore, RecruiterEmail
from app.models.evaluation import AuditLog, ResumeUpload
from app.models.schemas import ResumeDetailResponse, ResumeUploadItem, ResumeUploadResponse
from app.services.attachment_processor import upsert_candidate_from_parsed
from app.services.azure_services import blob_service
from app.services.resume_parser import resume_parser
from app.storage.store import Store, store
from app.utils.error_handlers import NotFoundError, ValidationAppError
from app.utils.logger import get_logger
from app.utils.validators import (
    ALLOWED_RESUME_EXTENSIONS,
    MAX_RESUME_SIZE_BYTES,
    is_allowed_resume_filename,
)

router = APIRouter()
logger = get_logger(__name__)


def _log_audit(active_store: Store, **fields) -> None:
    try:
        active_store.audit_logs.save(AuditLog(**fields))
    except Exception as exc:
        logger.warning("Failed to persist audit log %s: %s", fields.get("action"), exc)


def _process_resume(upload_id: uuid.UUID) -> None:
    # Background tasks run outside the request/response cycle (and outside
    # FastAPI's dependency-injection scope), so this uses the module-level
    # `store` singleton directly rather than the per-request `AppStore` —
    # mirrors the old code opening its own `SessionLocal()` here.
    upload = store.resume_uploads.get(upload_id)
    if not upload or not upload.blob_path:
        return

    try:
        upload.status = "ocr"
        upload.progress = 40
        store.resume_uploads.save(upload)

        file_bytes = blob_service.download_bytes(upload.blob_path)
        text = asyncio.run(resume_parser.extract_resume_text(file_bytes, upload.filename))

        upload.status = "parsing"
        upload.progress = 70
        store.resume_uploads.save(upload)

        parsed = asyncio.run(resume_parser.parse_resume(text))

        candidate = upsert_candidate_from_parsed(store, parsed, text, upload.blob_path)

        upload.candidate_id = candidate.id
        upload.status = "complete"
        upload.progress = 100
        store.resume_uploads.save(upload)
    except Exception as exc:
        logger.exception("Resume processing failed for %s", upload_id)
        upload = store.resume_uploads.get(upload_id)
        if upload:
            upload.status = "failed"
            upload.error = str(exc)
            upload.progress = 100
            store.resume_uploads.save(upload)


@router.post("/upload", response_model=ResumeUploadResponse)
async def upload_resumes(
    background_tasks: BackgroundTasks,
    store: AppStore,
    recruiter_email: RecruiterEmail,
    files: list[UploadFile] = File(...),
):
    if not files:
        raise ValidationAppError("No files provided")

    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    batch_id = str(uuid.uuid4())
    items: list[ResumeUploadItem] = []
    # Only filenames that already produced a candidate count as duplicates —
    # a prior failed/unprocessed attempt with the same name must not block a
    # retry from ever being processed.
    seen_names = {
        row.filename.lower()
        for row in store.resume_uploads.list_all()
        if row.candidate_id is not None
    }

    for file in files:
        filename = file.filename or "resume.pdf"
        if not is_allowed_resume_filename(filename):
            upload = ResumeUpload(
                filename=filename,
                status="failed",
                progress=100,
                error=f"Unsupported file type. Allowed: {sorted(ALLOWED_RESUME_EXTENSIONS)}",
            )
            store.resume_uploads.save(upload)
            items.append(
                ResumeUploadItem(
                    resume_id=upload.id,
                    filename=filename,
                    status=upload.status,
                    progress=upload.progress,
                    error=upload.error,
                )
            )
            continue

        content = await file.read()
        if len(content) > MAX_RESUME_SIZE_BYTES:
            upload = ResumeUpload(
                filename=filename,
                status="failed",
                progress=100,
                error="File exceeds 15MB limit",
            )
            store.resume_uploads.save(upload)
            items.append(
                ResumeUploadItem(
                    resume_id=upload.id,
                    filename=filename,
                    status=upload.status,
                    progress=upload.progress,
                    error=upload.error,
                )
            )
            continue

        is_duplicate = filename.lower() in seen_names
        seen_names.add(filename.lower())

        blob_path = blob_service.upload_bytes(
            content,
            filename,
            content_type=file.content_type or "application/pdf",
        )
        upload = ResumeUpload(
            filename=filename,
            blob_path=blob_path,
            status="duplicate" if is_duplicate else "queued",
            progress=10 if not is_duplicate else 0,
        )
        store.resume_uploads.save(upload)

        if not is_duplicate:
            upload.status = "uploading"
            upload.progress = 25
            store.resume_uploads.save(upload)
            background_tasks.add_task(_process_resume, upload.id)

        items.append(
            ResumeUploadItem(
                resume_id=upload.id,
                filename=filename,
                status=upload.status,
                progress=upload.progress,
                duplicate=is_duplicate,
            )
        )

    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="upload_resumes",
        resource_type="resume_batch",
        details={"batch_id": batch_id, "count": len(items)},
    )

    return ResumeUploadResponse(
        batch_id=batch_id,
        files=items,
        message=f"Accepted {len(items)} file(s) for processing",
    )


@router.get("/{resume_id}", response_model=ResumeDetailResponse)
def get_resume(resume_id: uuid.UUID, store: AppStore):
    upload = store.resume_uploads.get(resume_id)
    if not upload:
        raise NotFoundError("Resume upload not found", {"resume_id": str(resume_id)})

    candidate = store.candidates.get(upload.candidate_id) if upload.candidate_id else None
    return ResumeDetailResponse(
        resume_id=upload.id,
        filename=upload.filename,
        status=upload.status,
        progress=upload.progress,
        error=upload.error,
        blob_path=upload.blob_path,
        candidate=candidate,
    )


@router.post("/{resume_id}/parse", response_model=ResumeDetailResponse)
def reparse_resume(
    resume_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    upload = store.resume_uploads.get(resume_id)
    if not upload:
        raise NotFoundError("Resume upload not found", {"resume_id": str(resume_id)})
    if not upload.blob_path:
        raise ValidationAppError("Resume has no stored file to re-parse")

    upload.status = "queued"
    upload.progress = 0
    upload.error = None
    store.resume_uploads.save(upload)
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="reparse_resume",
        resource_type="resume",
        resource_id=upload.id,
    )
    background_tasks.add_task(_process_resume, upload.id)

    return ResumeDetailResponse(
        resume_id=upload.id,
        filename=upload.filename,
        status=upload.status,
        progress=upload.progress,
        error=upload.error,
        blob_path=upload.blob_path,
        candidate=None,
    )
