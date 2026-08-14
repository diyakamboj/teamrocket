import uuid

from fastapi import APIRouter, Query

from app.dependencies import AppStore, RecruiterEmail
from app.models.schemas import AgentEvaluationSummary
from app.services import internal_marketplace_service

router = APIRouter()


@router.get("/matches", response_model=list[AgentEvaluationSummary])
async def get_internal_matches(
    store: AppStore,
    recruiter_email: RecruiterEmail,
    job_id: uuid.UUID = Query(...),
    bench_priority: bool = Query(True),
):
    return await internal_marketplace_service.get_internal_matches(
        store, job_id, bench_priority=bench_priority, persist=True
    )
