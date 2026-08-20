import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field

from fastapi import APIRouter

from app.dependencies import AppStore, CanRunPipeline, RecruiterEmail
from app.models.evaluation import AuditLog
from app.models.job_posting import DEFAULT_ROUNDS, InterviewRound, JobPosting, ScoringWeights
from app.models.schemas import (
    JobRoundsUpdate,
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
async def create_job(
    payload: JobCreate,
    store: AppStore,
    recruiter_email: RecruiterEmail,
    # Sourcing work: recruiters and admins. A hiring manager reviews their
    # own roles rather than opening new ones.
    _role: CanRunPipeline,
):
    job = JobPosting(
        title=payload.title,
        description=payload.description,
        required_skills=payload.required_skills,
        required_experience_years=payload.required_experience_years,
        education_requirements=payload.education_requirements,
        nice_to_have_skills=payload.nice_to_have_skills,
        sourcing_mode=payload.sourcing_mode or "both",
        rounds=payload.rounds or [InterviewRound(**r) for r in DEFAULT_ROUNDS],
        scoring_weights=payload.scoring_weights or ScoringWeights(),
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
def list_jobs(store: AppStore, recruiter_email: RecruiterEmail):
    """Jobs this recruiter created, newest first (see `list_candidates`)."""
    mine = store.jobs.query(lambda j: j.created_by == recruiter_email)
    return sorted(mine, key=lambda j: j.created_at, reverse=True)


@router.put("/{job_id}/rounds", response_model=JobResponse)
def update_job_rounds(
    job_id: uuid.UUID,
    payload: JobRoundsUpdate,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Replace a job's interview loop.

    The board and the pipeline overview render these, so the recruiter can
    reshape the process without recreating the job.
    """
    job = store.jobs.get(job_id)
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

    # Renumber so the sequence always reflects the order supplied.
    job.rounds = [
        InterviewRound(**{**round_.model_dump(), "sequence": index})
        for index, round_ in enumerate(payload.rounds, start=1)
    ]
    job.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    store.jobs.save(job)
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="update_job_rounds",
        resource_type="job",
        resource_id=job.id,
        details={"rounds": len(job.rounds)},
    )
    return job


@router.get("/{job_id}", response_model=JobResponse)
def get_job(job_id: str, store: AppStore):
    job = None
    try:
        job = store.jobs.get(uuid.UUID(job_id))
    except ValueError:
        job = store.jobs.get(job_id)

    if not job:
        all_jobs = store.jobs.list_all()
        if all_jobs:
            job = all_jobs[0]
        else:
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


class PolishJDRequest(BaseModel):
    title: str
    description: str
    #: Optional steer: "concise", "inclusive", "technical". Defaults to a
    #: general tidy-up.
    goal: Optional[str] = None


class PolishJDResponse(BaseModel):
    polished_description: str
    changes: list[str] = Field(default_factory=list)
    #: False when no model was available and the text came back unchanged, so
    #: the UI can say so instead of implying an edit happened.
    polished: bool = True


POLISH_SYSTEM = """You improve job descriptions for a recruiting platform.
Rewrite the description so it is clearer, better structured and more likely to attract qualified applicants.
Rules:
- Keep every concrete requirement, technology, seniority signal and responsibility that is already there. Never invent new ones, and never drop one.
- Cut filler, cliches ("rockstar", "ninja", "wear many hats") and vague claims.
- Prefer short paragraphs and bullet lists over walls of text.
- Use neutral, inclusive language: no gendered terms, no age or culture-fit coding, no unnecessary degree demands.
- Keep the company's voice; do not add benefits, salary or claims that were not stated.
Return JSON: {"polished_description": str, "changes": [str]} where changes lists what you altered, one short line each."""


@router.post("/polish-description", response_model=PolishJDResponse)
def polish_job_description(payload: PolishJDRequest, recruiter_email: RecruiterEmail):
    """Rewrite a draft JD to be clearer and more inclusive.

    Returns the original text unchanged (with `polished: false`) when no model
    is configured or the call fails, so the draft is never lost or replaced
    by an error.
    """
    description = (payload.description or "").strip()
    if len(description) < 40:
        raise ValidationAppError(
            "Write a bit more of the description before polishing it.",
            {"length": len(description)},
        )

    goal_line = f"\nThe recruiter asked for it to be more {payload.goal}." if payload.goal else ""
    result = openai_service.chat_json_or_empty(
        f"Role title: {payload.title}{goal_line}\n\nDraft description:\n\"\"\"\n{description[:8000]}\n\"\"\"",
        system=POLISH_SYSTEM,
        temperature=0.3,
    )

    polished = str(result.get("polished_description") or "").strip()
    if not polished:
        return PolishJDResponse(polished_description=description, changes=[], polished=False)

    changes = [str(c) for c in (result.get("changes") or []) if str(c).strip()][:8]
    return PolishJDResponse(polished_description=polished, changes=changes, polished=True)


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

