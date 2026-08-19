import uuid
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.dependencies import AppStore, RecruiterEmail
from app.models.evaluation import AuditLog
from app.models.job_posting import JobPosting
from app.models.schemas import (
    JobAnalyzeResponse,
    JobCreate,
    JobDraftAnalyzeRequest,
    JobResponse,
    JobUpdate,
)
from app.services.azure_services import openai_service
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
        sourcing_mode=payload.sourcing_mode or "both",
        created_by=payload.created_by or recruiter_email,
        location=payload.location,
        department=payload.department if hasattr(payload, 'department') else None,
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
def get_job(job_id: str, store: AppStore):
    try:
        job = store.jobs.get(uuid.UUID(job_id))
    except ValueError:
        job = None
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": job_id})
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


class GenerateJDRequest(BaseModel):
    title: str
    department: Optional[str] = None
    location: Optional[str] = None
    employment_type: Optional[str] = None


class GenerateJDResponse(BaseModel):
    description: str


@router.post("/generate-description", response_model=GenerateJDResponse)
async def generate_job_description(payload: GenerateJDRequest):
    """Uses Azure OpenAI to generate a full professional job description."""
    prompt = f"""Write a professional job description for the following role.

Role: {payload.title}
Department: {payload.department or 'Not specified'}
Location: {payload.location or 'Flexible / Remote'}
Employment Type: {payload.employment_type or 'Full-time'}

The job description should include:
- A compelling 2-3 sentence overview of the role and its impact
- Key responsibilities (6-8 bullet points)
- Required qualifications and skills (5-7 bullet points)
- Nice-to-have / preferred skills (3-4 bullet points)
- A brief closing statement about the team/company culture

Write in a professional, engaging tone. Do not use placeholders. Output only the job description text, no extra commentary."""

    if openai_service.mock:
        description = f"""We are looking for a talented {payload.title} to join our {payload.department or 'team'}.

**About the Role**
As a {payload.title}, you will play a key role in driving technical excellence and delivering high-quality solutions. You will collaborate cross-functionally to build scalable, reliable systems that make a real impact.

**Key Responsibilities**
- Design, build, and maintain high-quality software systems
- Collaborate with product, design, and engineering teams
- Write clean, well-tested, maintainable code
- Participate in code reviews and technical discussions
- Identify and resolve performance bottlenecks
- Contribute to architectural decisions and best practices
- Mentor junior team members

**Required Qualifications**
- 3+ years of relevant professional experience
- Strong problem-solving and communication skills
- Experience with modern software development practices
- Proficiency in relevant programming languages and frameworks
- Familiarity with cloud platforms (AWS, Azure, or GCP)

**Nice to Have**
- Experience with distributed systems
- Contributions to open-source projects
- Experience in a fast-paced startup environment

We value curiosity, collaboration, and a growth mindset. If you're excited about solving complex problems and making a real impact, we'd love to hear from you."""
    else:
        description = openai_service.chat_text(
            prompt,
            system="You are a professional technical recruiter who writes compelling, accurate job descriptions.",
            temperature=0.7,
        )

    return GenerateJDResponse(description=description)


@router.post("/analyze-draft", response_model=JobAnalyzeResponse)
async def analyze_job_draft(payload: JobDraftAnalyzeRequest, recruiter_email: RecruiterEmail):
    """Extracts requirements from a draft JD without creating a job.

    Lets the job-creation flow show real extracted requirements while the
    recruiter is still editing, instead of persisting a throwaway job just to
    be able to call the analyzer.
    """
    if not payload.title.strip():
        raise ValidationAppError("A job title is required to analyze a draft")

    analysis = await job_analyzer.analyze(payload.title, payload.description)
    return JobAnalyzeResponse(
        job_id=None,
        title=payload.title,
        required_skills=list(analysis.get("required_skills") or []),
        nice_to_have_skills=list(analysis.get("nice_to_have_skills") or []),
        required_experience_years=analysis.get("required_experience_years"),
        education_requirements=analysis.get("education_requirements"),
        summary=analysis.get("summary"),
        requirements=analysis.get("requirements") or [],
        analyzed_by=analysis.get("analyzed_by"),
    )


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

