import uuid

from fastapi import APIRouter

from app.dependencies import DbSession, RecruiterEmail
from app.models.evaluation import AuditLog
from app.models.job_posting import JobPosting
from app.models.schemas import JobAnalyzeResponse, JobCreate, JobResponse, JobUpdate
from app.services.job_analyzer import job_analyzer
from app.utils.error_handlers import NotFoundError

router = APIRouter()


@router.post("", response_model=JobResponse)
async def create_job(payload: JobCreate, db: DbSession, recruiter_email: RecruiterEmail):
    job = JobPosting(
        title=payload.title,
        description=payload.description,
        required_skills=payload.required_skills,
        required_experience_years=payload.required_experience_years,
        education_requirements=payload.education_requirements,
        nice_to_have_skills=payload.nice_to_have_skills,
        created_by=payload.created_by or recruiter_email,
    )
    db.add(job)
    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="create_job",
            resource_type="job",
            details={"title": payload.title},
        )
    )
    db.commit()
    db.refresh(job)
    return job


@router.get("", response_model=list[JobResponse])
def list_jobs(db: DbSession):
    return db.query(JobPosting).order_by(JobPosting.created_at.desc()).all()


@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: uuid.UUID, db: DbSession):
    job = db.get(JobPosting, job_id)
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})
    return job


@router.put("/{job_id}", response_model=JobResponse)
def update_job(
    job_id: uuid.UUID,
    payload: JobUpdate,
    db: DbSession,
    recruiter_email: RecruiterEmail,
):
    job = db.get(JobPosting, job_id)
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(job, field, value)

    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="update_job",
            resource_type="job",
            resource_id=job.id,
        )
    )
    db.commit()
    db.refresh(job)
    return job


@router.post("/{job_id}/analyze", response_model=JobAnalyzeResponse)
async def analyze_job(
    job_id: uuid.UUID,
    db: DbSession,
    recruiter_email: RecruiterEmail,
):
    job = db.get(JobPosting, job_id)
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

    analysis = await job_analyzer.analyze(job.title, job.description)
    job.required_skills = analysis["required_skills"] or job.required_skills
    job.nice_to_have_skills = analysis["nice_to_have_skills"] or job.nice_to_have_skills
    if analysis.get("required_experience_years") is not None:
        job.required_experience_years = analysis["required_experience_years"]
    if analysis.get("education_requirements"):
        job.education_requirements = analysis["education_requirements"]

    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="analyze_job",
            resource_type="job",
            resource_id=job.id,
            details={"required_skills": job.required_skills},
        )
    )
    db.commit()
    db.refresh(job)

    return JobAnalyzeResponse(
        job_id=job.id,
        title=job.title,
        required_skills=list(job.required_skills or []),
        nice_to_have_skills=list(job.nice_to_have_skills or []),
        required_experience_years=job.required_experience_years,
        education_requirements=job.education_requirements,
        summary=analysis.get("summary"),
    )
