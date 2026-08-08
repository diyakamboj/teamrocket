import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, UploadFile

from app.config import settings
from app.dependencies import DbSession, RecruiterEmail
from app.models.candidate import Candidate
from app.models.evaluation import AuditLog, ResumeUpload
from app.models.schemas import ResumeDetailResponse, ResumeUploadItem, ResumeUploadResponse
from app.services.azure_services import blob_service
from app.services.resume_parser import resume_parser
from app.utils.error_handlers import NotFoundError, ValidationAppError
from app.utils.logger import get_logger
from app.utils.validators import (
    ALLOWED_RESUME_EXTENSIONS,
    MAX_RESUME_SIZE_BYTES,
    is_allowed_resume_filename,
    is_valid_email,
)

router = APIRouter()
logger = get_logger(__name__)


def _process_resume(upload_id: uuid.UUID) -> None:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        upload = db.get(ResumeUpload, upload_id)
        if not upload or not upload.blob_path:
            return

        upload.status = "ocr"
        upload.progress = 40
        db.commit()

        file_bytes = blob_service.download_bytes(upload.blob_path)
        text = asyncio.run(resume_parser.extract_resume_text(file_bytes, upload.filename))

        upload.status = "parsing"
        upload.progress = 70
        db.commit()

        parsed = asyncio.run(resume_parser.parse_resume(text))

        email = parsed["email"]
        if not is_valid_email(email):
            email = f"candidate.{upload.id.hex[:10]}@example.com"
            parsed["email"] = email

        existing = db.query(Candidate).filter(Candidate.email == email).first()
        if existing:
            candidate = existing
            candidate.name = parsed["name"] or candidate.name
            candidate.phone = parsed.get("phone") or candidate.phone
            candidate.resume_file_id = upload.blob_path
            candidate.resume_text = text
            candidate.skills = parsed.get("skills") or candidate.skills
            candidate.experience = parsed.get("experience") or candidate.experience
            candidate.education = parsed.get("education") or candidate.education
            candidate.certifications = parsed.get("certifications") or candidate.certifications
            candidate.projects = parsed.get("projects") or candidate.projects
            candidate.github_url = parsed.get("github_url") or candidate.github_url
            candidate.linkedin_url = parsed.get("linkedin_url") or candidate.linkedin_url
            candidate.portfolio_url = parsed.get("portfolio_url") or candidate.portfolio_url
        else:
            candidate = Candidate(
                name=parsed["name"],
                email=email,
                phone=parsed.get("phone"),
                resume_file_id=upload.blob_path,
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
            db.add(candidate)

        db.flush()
        upload.candidate_id = candidate.id
        upload.status = "complete"
        upload.progress = 100
        db.commit()
    except Exception as exc:
        logger.exception("Resume processing failed for %s", upload_id)
        upload = db.get(ResumeUpload, upload_id)
        if upload:
            upload.status = "failed"
            upload.error = str(exc)
            upload.progress = 100
            db.commit()
    finally:
        db.close()


@router.post("/upload", response_model=ResumeUploadResponse)
async def upload_resumes(
    background_tasks: BackgroundTasks,
    db: DbSession,
    recruiter_email: RecruiterEmail,
    files: list[UploadFile] = File(...),
):
    if not files:
        raise ValidationAppError("No files provided")

    Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    batch_id = str(uuid.uuid4())
    items: list[ResumeUploadItem] = []
    seen_names = {
        row.filename.lower()
        for row in db.query(ResumeUpload).all()
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
            db.add(upload)
            db.flush()
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
            db.add(upload)
            db.flush()
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
        db.add(upload)
        db.flush()

        if not is_duplicate:
            upload.status = "uploading"
            upload.progress = 25
            db.flush()
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

    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="upload_resumes",
            resource_type="resume_batch",
            details={"batch_id": batch_id, "count": len(items)},
        )
    )
    db.commit()

    return ResumeUploadResponse(
        batch_id=batch_id,
        files=items,
        message=f"Accepted {len(items)} file(s) for processing",
    )


@router.get("/{resume_id}", response_model=ResumeDetailResponse)
def get_resume(resume_id: uuid.UUID, db: DbSession):
    upload = db.get(ResumeUpload, resume_id)
    if not upload:
        raise NotFoundError("Resume upload not found", {"resume_id": str(resume_id)})

    candidate = db.get(Candidate, upload.candidate_id) if upload.candidate_id else None
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
    db: DbSession,
    recruiter_email: RecruiterEmail,
):
    upload = db.get(ResumeUpload, resume_id)
    if not upload:
        raise NotFoundError("Resume upload not found", {"resume_id": str(resume_id)})
    if not upload.blob_path:
        raise ValidationAppError("Resume has no stored file to re-parse")

    upload.status = "queued"
    upload.progress = 0
    upload.error = None
    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="reparse_resume",
            resource_type="resume",
            resource_id=upload.id,
        )
    )
    db.commit()
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
