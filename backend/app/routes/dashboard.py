import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.dependencies import AppStore, RecruiterEmail
from app.models.schemas import (
    CandidateMoveRequest,
    CandidatePlacementResponse,
    DashboardDistribution,
    DashboardInsights,
    JDOptimizationResponse,
    JDRecommendation,
    JDRecommendationDecisionRequest,
    JobPipelineSummary,
    PipelineCandidate,
)
from app.services import hiring_progress, job_pipeline_service, placement_service
from app.services.hiring_insights import hiring_insights
from app.services.jd_optimizer import jd_optimizer
from app.utils.error_handlers import NotFoundError

router = APIRouter()


@router.get("/job/{job_id}/insights", response_model=DashboardInsights)
async def job_insights(job_id: uuid.UUID, store: AppStore):
    return await hiring_insights.get_insights(store, job_id)


@router.get("/job/{job_id}/jd-optimization", response_model=JDOptimizationResponse)
async def job_jd_optimization(job_id: uuid.UUID, store: AppStore):
    return await jd_optimizer.get_optimization(store, job_id)


@router.post(
    "/job/{job_id}/jd-optimization/{recommendation_id}/decision",
    response_model=JDRecommendation,
)
async def job_jd_optimization_decision(
    job_id: uuid.UUID,
    recommendation_id: uuid.UUID,
    payload: JDRecommendationDecisionRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    return jd_optimizer.record_decision(
        store,
        job_id,
        recommendation_id,
        status=payload.status,
        note=payload.note,
        recruiter_email=recruiter_email,
    )


@router.get("/job/{job_id}/distribution", response_model=DashboardDistribution)
async def job_distribution(job_id: uuid.UUID, store: AppStore):
    return await hiring_insights.get_distribution(store, job_id)


@router.get("/jobs", response_model=list[JobPipelineSummary])
def list_job_pipelines(store: AppStore, recruiter_email: RecruiterEmail):
    """Top-level recruiter dashboard: this recruiter's jobs with pipeline counts."""
    return job_pipeline_service.get_job_pipeline_summaries(store, recruiter_email)


class HiredCandidate(BaseModel):
    """Someone who filled this role. No longer an open candidate."""

    candidate_id: str
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    hired_at: Optional[datetime] = None
    source: Optional[str] = None
    current_assignment: Optional[str] = None


@router.get("/jobs/{job_id}/progress")
def get_job_progress(
    job_id: uuid.UUID,
    store: AppStore,
    recruiter_email: RecruiterEmail,
    source: Optional[str] = Query(None),
):
    """Per-candidate checklist and the single next action for each.

    Computed server-side so the board and any other view cannot disagree
    about what the recruiter should do next.
    """
    job = store.jobs.get(job_id)
    if not job or (job.created_by and job.created_by != recruiter_email):
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

    rows = job_pipeline_service.get_job_pipeline_candidates(store, job, source)
    return hiring_progress.candidate_progress_for_job(store, job, rows)


@router.get("/jobs/{job_id}/hired", response_model=list[HiredCandidate])
def get_job_hires(job_id: uuid.UUID, store: AppStore, recruiter_email: RecruiterEmail):
    """Who was hired into this role."""
    job = store.jobs.get(job_id)
    if not job or (job.created_by and job.created_by != recruiter_email):
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

    hires = job_pipeline_service.hired_candidates_for_job(store, job)
    hires.sort(key=lambda c: c.hired_at or c.created_at, reverse=True)
    return [
        HiredCandidate(
            candidate_id=str(c.id),
            name=c.name,
            title=c.title,
            email=c.email,
            hired_at=c.hired_at,
            source=c.source,
            current_assignment=c.current_assignment,
        )
        for c in hires
    ]


@router.get("/jobs/{job_id}/pipeline", response_model=list[PipelineCandidate])
def get_job_pipeline(
    job_id: str,
    store: AppStore,
    recruiter_email: RecruiterEmail,
    source: Optional[str] = Query(default=None, description="internal | external | all"),
):
    """This job's pipeline.

    An unknown id used to fall back to whichever job happened to be first in
    the store and return *its* pipeline — so a mistyped id silently showed
    another job's candidates, and once jobs became owner-scoped, potentially
    another recruiter's. Unknown or not-yours is now a 404.
    """
    try:
        job = store.jobs.get(uuid.UUID(job_id))
    except ValueError:
        job = store.jobs.get(job_id)

    if not job or (job.created_by and job.created_by != recruiter_email):
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

    return job_pipeline_service.get_job_pipeline_candidates(store, job, source)


@router.put(
    "/jobs/{job_id}/pipeline/{candidate_id}",
    response_model=CandidatePlacementResponse,
)
def move_pipeline_candidate(
    job_id: uuid.UUID,
    candidate_id: str,
    payload: CandidateMoveRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Move a candidate to a stage, and into a round when interviewing.

    The board and the pipeline overview both call this, so a move made in
    one is visible in the other without either owning the rule.
    """
    job = store.jobs.get(job_id)
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

    candidate = store.candidates.get(candidate_id)
    placement = placement_service.move_candidate(
        store,
        job=job,
        candidate_id=candidate_id,
        candidate_name=payload.candidate_name
        or (candidate.name if candidate else "Candidate"),
        stage=payload.stage,
        round_id=payload.round_id,
        actor_email=recruiter_email,
        note=payload.note,
    )
    round_name = next(
        (r.name for r in (job.rounds or []) if r.id == placement.round_id), None
    )
    return CandidatePlacementResponse(
        job_id=placement.job_id,
        candidate_id=placement.candidate_id,
        stage=placement.stage,
        round_id=placement.round_id,
        round_name=round_name,
        round_sequence=placement.round_sequence,
        moved_by=placement.moved_by,
        moved_by_name=placement.moved_by_name,
        moved_by_role=placement.moved_by_role,
        note=placement.note,
        updated_at=placement.updated_at,
    )

