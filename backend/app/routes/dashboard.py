import uuid
from typing import Optional

from fastapi import APIRouter, Query

from app.dependencies import AppStore, RecruiterEmail
from app.models.schemas import (
    DashboardDistribution,
    DashboardInsights,
    JDOptimizationResponse,
    JDRecommendation,
    JDRecommendationDecisionRequest,
    JobPipelineSummary,
    PipelineCandidate,
)
from app.services import job_pipeline_service
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
def list_job_pipelines(store: AppStore):
    """Top-level recruiter dashboard: every job with candidate/pipeline counts."""
    return job_pipeline_service.get_job_pipeline_summaries(store)


@router.get("/jobs/{job_id}/pipeline", response_model=list[PipelineCandidate])
def get_job_pipeline(
    job_id: uuid.UUID,
    store: AppStore,
    source: Optional[str] = Query(default=None, description="internal | external | all"),
):
    job = store.jobs.get(job_id)
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})
    return job_pipeline_service.get_job_pipeline_candidates(store, job, source)

