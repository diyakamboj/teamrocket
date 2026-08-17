import uuid

from fastapi import APIRouter

from app.dependencies import DbSession
from app.models.schemas import DashboardDistribution, DashboardInsights, JDOptimizationResponse
from app.services.hiring_insights import hiring_insights
from app.services.jd_optimizer import jd_optimizer

router = APIRouter()


@router.get("/job/{job_id}/insights", response_model=DashboardInsights)
async def job_insights(job_id: uuid.UUID, db: DbSession):
    return await hiring_insights.get_insights(db, job_id)


@router.get("/job/{job_id}/jd-optimization", response_model=JDOptimizationResponse)
async def job_jd_optimization(job_id: uuid.UUID, db: DbSession):
    return await jd_optimizer.get_optimization(db, job_id)


@router.get("/job/{job_id}/distribution", response_model=DashboardDistribution)
async def job_distribution(job_id: uuid.UUID, db: DbSession):
    return await hiring_insights.get_distribution(db, job_id)
