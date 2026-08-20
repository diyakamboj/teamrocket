import asyncio
import uuid
from pathlib import Path

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile

from app.config import settings
from app.dependencies import AppStore, CanRunPipeline, RecruiterEmail
from app.models.evaluation import AuditLog, ResumeUpload
from app.models.schemas import ResumeDetailResponse, ResumeUploadItem, ResumeUploadResponse
from app.services.attachment_processor import upsert_candidate_from_parsed
from app.services.azure_services import blob_service
from starlette.concurrency import run_in_threadpool

from app.services import candidate_dedupe
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

        # The same person can arrive as a different file — a re-export, a
        # newer version, a different name on disk. Content hashing cannot see
        # that; the parsed identity can, and this is the first moment it is
        # known. Refuse rather than quietly merging, so the recruiter learns
        # the person is already theirs and can add them to another role from
        # the profile instead.
        existing = candidate_dedupe.find_existing_candidate(
            store,
            owner_email=upload.recruiter_email,
            email=parsed.get("email"),
            name=parsed.get("name"),
            phone=parsed.get("phone"),
        )
        if existing is not None:
            upload.status = "duplicate"
            upload.progress = 100
            upload.candidate_id = existing.id
            upload.error = candidate_dedupe.already_in_pool_message(existing)
            store.resume_uploads.save(upload)
            return

        candidate = upsert_candidate_from_parsed(
            store,
            parsed,
            text,
            upload.blob_path,
            owner_email=upload.recruiter_email,
            job_id=upload.job_id,
            source=upload.source,
            current_position=upload.current_position,
            current_role_duties=upload.current_role_duties,
        )

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
    job_id: Optional[str] = Form(
        None,
        description="Role these résumés are for. Omit to add them to the pool without a job.",
    ),
    source: str = Form(
        "external",
        description="'internal' for an existing employee, 'external' for an outside applicant.",
    ),
    current_position: Optional[str] = Form(
        None, description="Internal only: the role they hold in the company today."
    ),
    current_role_duties: Optional[str] = Form(
        None, description="Internal only: what they do in that role."
    ),
    _role: CanRunPipeline = None,
):
    if not files:
        raise ValidationAppError("No files provided")

    # Uploading against a role is how a candidate ends up on that board and
    # no other. A bad id is rejected rather than quietly dropped, which would
    # scatter the batch into the general pool.
    # Internal and external are different populations with different
    # workflows, so which one a résumé belongs to is decided at intake rather
    # than defaulting to external and being corrected later.
    if source not in ("internal", "external"):
        raise ValidationAppError(
            "source must be 'internal' or 'external'", {"source": source}
        )

    target_job: Optional[uuid.UUID] = None
    if job_id:
        try:
            target_job = uuid.UUID(job_id)
        except ValueError:
            raise ValidationAppError("job_id must be a UUID", {"job_id": job_id})
        job = store.jobs.get(target_job)
        if not job or (job.created_by and job.created_by != recruiter_email):
            raise NotFoundError("Job posting not found", {"job_id": job_id})

    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    batch_id = str(uuid.uuid4())
    items: list[ResumeUploadItem] = []
    # Duplicate detection is per recruiter: matching on every upload ever made
    # meant one recruiter's "resume.pdf" silently marked another's as a
    # duplicate, so the file was skipped and no candidate ever appeared.
    # Only filenames that already produced a candidate count as duplicates —
    # a prior failed/unprocessed attempt with the same name must not block a
    # retry from ever being processed.
    #: Digests seen earlier in *this* batch, so the same file dropped twice
    #: in one go is caught before either copy is processed.
    seen_digests: set[str] = set()

    # One scan of prior uploads, in a worker thread. This reads every upload
    # record from blob storage: run per file, and on the event loop, it made
    # a multi-file upload block the whole server.
    known_digests = await run_in_threadpool(
        candidate_dedupe.digests_for_recruiter, store, recruiter_email
    )

    for file in files:
        filename = file.filename or "resume.pdf"
        if not is_allowed_resume_filename(filename):
            upload = ResumeUpload(
                recruiter_email=recruiter_email,
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
                recruiter_email=recruiter_email,
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

        # Identity by content, not by filename: "resume (1).pdf" is the same
        # résumé, and two different people both called it "resume.pdf".
        digest = candidate_dedupe.content_digest(content)
        duplicate_of = known_digests.get(digest)
        if duplicate_of is None and digest in seen_digests:
            duplicate_of = "pending"  # same file twice within this one batch
        is_duplicate = duplicate_of is not None
        seen_digests.add(digest)

        duplicate_error = None
        if is_duplicate:
            existing = (
                store.candidates.get(duplicate_of) if duplicate_of != "pending" else None
            )
            duplicate_error = (
                candidate_dedupe.already_in_pool_message(existing)
                if existing
                else "That résumé is already in this upload."
            )

        blob_path = blob_service.upload_bytes(
            content,
            filename,
            content_type=file.content_type or "application/pdf",
        )
        upload = ResumeUpload(
            recruiter_email=recruiter_email,
            job_id=target_job,
            source=source,
            # Only meaningful for an employee; an external applicant has no
            # position here to record.
            current_position=current_position if source == "internal" else None,
            current_role_duties=current_role_duties if source == "internal" else None,
            filename=filename,
            content_sha256=digest,
            blob_path=blob_path,
            status="duplicate" if is_duplicate else "queued",
            progress=100 if is_duplicate else 10,
            error=duplicate_error,
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
