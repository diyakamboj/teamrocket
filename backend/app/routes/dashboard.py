import uuid
from typing import Optional

from fastapi import APIRouter, Query

from app.dependencies import DbSession
from app.models.job_posting import JobPosting
from app.models.schemas import (
    DashboardDistribution,
    DashboardInsights,
    JobPipelineSummary,
    PipelineCandidate,
)
from app.services import job_pipeline_service
from app.services.hiring_insights import hiring_insights
from app.utils.error_handlers import NotFoundError

router = APIRouter()


@router.get("/job/{job_id}/insights", response_model=DashboardInsights)
async def job_insights(job_id: uuid.UUID, db: DbSession):
    return await hiring_insights.get_insights(db, job_id)


@router.get("/job/{job_id}/distribution", response_model=DashboardDistribution)
async def job_distribution(job_id: uuid.UUID, db: DbSession):
    return await hiring_insights.get_distribution(db, job_id)


@router.get("/jobs", response_model=list[JobPipelineSummary])
def list_job_pipelines(db: DbSession):
    """Top-level recruiter dashboard: every job with candidate/pipeline counts."""
    return job_pipeline_service.get_job_pipeline_summaries(db)


@router.get("/jobs/{job_id}/pipeline", response_model=list[PipelineCandidate])
def get_job_pipeline(
    job_id: uuid.UUID,
    db: DbSession,
    source: Optional[str] = Query(default=None, description="internal | external | all"),
):
    job = db.get(JobPosting, job_id)
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})
    return job_pipeline_service.get_job_pipeline_candidates(db, job, source)
