import uuid

from fastapi import APIRouter

from app.dependencies import AppStore, RecruiterEmail
from app.models.evaluation import AuditLog
from app.models.job_posting import JobPosting
from app.models.schemas import JobAnalyzeResponse, JobCreate, JobResponse, JobUpdate
from app.services.job_analyzer import job_analyzer
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError, ValidationAppError
from app.utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


def _log_audit(store: Store, **fields) -> None:
    try:
        store.audit_logs.save(AuditLog(**fields))
    except Exception as exc:
        logger.warning("Failed to persist audit log %s: %s", fields.get("action"), exc)


@router.post("", response_model=JobResponse)
async def create_job(payload: JobCreate, store: AppStore, recruiter_email: RecruiterEmail):
    job = JobPosting(
        title=payload.title,
        description=payload.description,
        required_skills=payload.required_skills,
        required_experience_years=payload.required_experience_years,
        education_requirements=payload.education_requirements,
        nice_to_have_skills=payload.nice_to_have_skills,
        created_by=payload.created_by or recruiter_email,
    )
    store.jobs.save(job)
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="create_job",
        resource_type="job",
        details={"title": payload.title},
    )
    return job


@router.get("", response_model=list[JobResponse])
def list_jobs(store: AppStore):
    return sorted(store.jobs.list_all(), key=lambda j: j.created_at, reverse=True)


@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: uuid.UUID, store: AppStore):
    job = store.jobs.get(job_id)
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})
    return job


@router.put("/{job_id}", response_model=JobResponse)
def update_job(
    job_id: uuid.UUID,
    payload: JobUpdate,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    job = store.jobs.get(job_id)
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

    updates = payload.model_dump(exclude_unset=True)
    if "sourcing_mode" in updates and updates["sourcing_mode"] not in (
        "internal",
        "external",
        "both",
    ):
        raise ValidationAppError(
            "sourcing_mode must be 'internal', 'external', or 'both'",
            {"sourcing_mode": updates["sourcing_mode"]},
        )

    for field, value in updates.items():
        setattr(job, field, value)

    store.jobs.save(job)
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="update_job",
        resource_type="job",
        resource_id=job.id,
    )
    return job


@router.post("/{job_id}/analyze", response_model=JobAnalyzeResponse)
async def analyze_job(
    job_id: uuid.UUID,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    job = store.jobs.get(job_id)
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

    analysis = await job_analyzer.analyze(job.title, job.description)
    job.required_skills = analysis["required_skills"] or job.required_skills
    job.nice_to_have_skills = analysis["nice_to_have_skills"] or job.nice_to_have_skills
    if analysis.get("required_experience_years") is not None:
        job.required_experience_years = analysis["required_experience_years"]
    if analysis.get("education_requirements"):
        job.education_requirements = analysis["education_requirements"]

    store.jobs.save(job)
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="analyze_job",
        resource_type="job",
        resource_id=job.id,
        details={"required_skills": job.required_skills},
    )

    return JobAnalyzeResponse(
        job_id=job.id,
        title=job.title,
        required_skills=list(job.required_skills or []),
        nice_to_have_skills=list(job.nice_to_have_skills or []),
        required_experience_years=job.required_experience_years,
        education_requirements=job.education_requirements,
        summary=analysis.get("summary"),
        requirements=analysis.get("requirements") or [],
        analyzed_by=analysis.get("analyzed_by"),
    )


from app.services.jd_optimizer import jd_optimizer


@router.get("/{job_id}/optimization")
async def job_optimization(
    job_id: uuid.UUID,
    store: AppStore,
):
    return await jd_optimizer.get_optimization(store, job_id)

