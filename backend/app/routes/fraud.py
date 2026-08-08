from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.models.schemas import (
    FraudScreenBatchRequest,
    FraudScreenBatchResponse,
    FraudScreenRequest,
    FraudScreenResponse,
)
from app.services.fraud_service import screen_candidate

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
