import uuid

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.dependencies import AppStore
from app.models.schemas import (
    FraudScreenBatchRequest,
    FraudScreenBatchResponse,
    FraudScreenRequest,
    FraudScreenResponse,
    ResumeConsistencyBatchRequest,
    ResumeConsistencyBatchResponse,
    ResumeConsistencyResponse,
)
from app.services.fraud_service import screen_candidate
from app.services.resume_consistency_service import analyze_candidate
from app.utils.error_handlers import NotFoundError

router = APIRouter()


def _to_response(result) -> FraudScreenResponse:
    return FraudScreenResponse(
        status=result.status,
        risk_score=result.risk_score,
        summary=result.summary,
        checks=result.checks,
        sources=result.sources,
        signals=[{"id": s.id, "label": s.label, "severity": s.severity} for s in result.signals],
        details=result.details,
    )


@router.post("/screen", response_model=FraudScreenResponse)
async def screen(payload: FraudScreenRequest) -> FraudScreenResponse:
    result = await run_in_threadpool(
        screen_candidate,
        name=payload.name,
        email=payload.email,
        employers=payload.employers,
        education=payload.education,
        location=payload.location,
    )
    return _to_response(result)


@router.post("/screen/batch", response_model=FraudScreenBatchResponse)
async def screen_batch(payload: FraudScreenBatchRequest) -> FraudScreenBatchResponse:
    results = []
    for candidate in payload.candidates:
        result = await run_in_threadpool(
            screen_candidate,
            name=candidate.name,
            email=candidate.email,
            employers=candidate.employers,
            education=candidate.education,
            location=candidate.location,
        )
        response = _to_response(result)
        results.append(
            {
                "id": candidate.id,
                **response.model_dump(),
            }
        )
    return FraudScreenBatchResponse(results=results)


def _to_consistency_response(result) -> ResumeConsistencyResponse:
    return ResumeConsistencyResponse(
        candidate_id=result.candidate_id,
        flags=[
            {
                "id": f.id,
                "category": f.category,
                "label": f.label,
                "severity": f.severity,
                "detail": f.detail,
            }
            for f in result.flags
        ],
        flagged_count=result.flagged_count,
        requires_review=result.requires_review,
        summary=result.summary,
        engine=result.engine,
    )


@router.post("/consistency-check/batch", response_model=ResumeConsistencyBatchResponse)
async def consistency_check_batch(
    payload: ResumeConsistencyBatchRequest, store: AppStore
) -> ResumeConsistencyBatchResponse:
    # Registered before the /{candidate_id} route below — FastAPI matches
    # path operations in registration order, so the static "/batch" segment
    # must come first or it gets swallowed as a candidate_id path param.
    results = []
    for candidate_id in payload.candidate_ids:
        candidate = store.candidates.get(candidate_id)
        if not candidate:
            continue
        result = await run_in_threadpool(analyze_candidate, candidate)
        results.append(_to_consistency_response(result))
    return ResumeConsistencyBatchResponse(results=results)


@router.post("/consistency-check/{candidate_id}", response_model=ResumeConsistencyResponse)
async def consistency_check(candidate_id: uuid.UUID, store: AppStore) -> ResumeConsistencyResponse:
    candidate = store.candidates.get(candidate_id)
    if not candidate:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})
    result = await run_in_threadpool(analyze_candidate, candidate)
    return _to_consistency_response(result)
