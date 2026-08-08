import uuid

from fastapi import APIRouter

from app.dependencies import DbSession, RecruiterEmail
from app.models.candidate import Candidate
from app.models.evaluation import AuditLog, Evaluation, Evidence
from app.models.schemas import (
    BlindReviewRequest,
    CompareRequest,
    CompareResponse,
    EvidenceResponse,
    EvaluationResponse,
)
from app.services.candidate_comparison import candidate_comparison
from app.utils.error_handlers import NotFoundError
from app.utils.validators import redact_pii

router = APIRouter()


@router.post("/compare", response_model=CompareResponse)
async def compare_candidates(
    payload: CompareRequest,
    db: DbSession,
    recruiter_email: RecruiterEmail,
):
    result = await candidate_comparison.compare(
        db, payload.job_id, payload.candidate_ids
    )
    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="compare_candidates",
            resource_type="job",
            resource_id=payload.job_id,
            details={"candidate_ids": [str(c) for c in payload.candidate_ids]},
        )
    )
    db.commit()
    return result


@router.get("/{evaluation_id}/evidence", response_model=list[EvidenceResponse])
def get_evidence(evaluation_id: uuid.UUID, db: DbSession):
    evaluation = db.get(Evaluation, evaluation_id)
    if not evaluation:
        raise NotFoundError("Evaluation not found", {"evaluation_id": str(evaluation_id)})
    return (
        db.query(Evidence)
        .filter(Evidence.evaluation_id == evaluation_id)
        .order_by(Evidence.created_at.asc())
        .all()
    )


@router.get("/{evaluation_id}", response_model=EvaluationResponse)
def get_evaluation(evaluation_id: uuid.UUID, db: DbSession):
    evaluation = db.get(Evaluation, evaluation_id)
    if not evaluation:
        raise NotFoundError("Evaluation not found", {"evaluation_id": str(evaluation_id)})
    evidence = (
        db.query(Evidence)
        .filter(Evidence.evaluation_id == evaluation_id)
        .order_by(Evidence.created_at.asc())
        .all()
    )
    data = EvaluationResponse.model_validate(evaluation)
    data.evidence = [EvidenceResponse.model_validate(e) for e in evidence]
    return data


@router.post("/{candidate_id}/{job_id}/blind-review", response_model=EvaluationResponse)
def toggle_blind_review(
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    payload: BlindReviewRequest,
    db: DbSession,
    recruiter_email: RecruiterEmail,
):
    evaluation = (
        db.query(Evaluation)
        .filter(Evaluation.candidate_id == candidate_id, Evaluation.job_id == job_id)
        .first()
    )
    if not evaluation:
        raise NotFoundError(
            "Evaluation not found for candidate/job",
            {"candidate_id": str(candidate_id), "job_id": str(job_id)},
        )

    evaluation.blind_review_mode = payload.enabled
    if payload.enabled:
        evaluation.strengths = redact_pii(evaluation.strengths or "")
        evaluation.weaknesses = redact_pii(evaluation.weaknesses or "")
        evaluation.transferable_skills = redact_pii(evaluation.transferable_skills or "")

        candidate = db.get(Candidate, candidate_id)
        # Do not mutate persisted PII permanently; redact only response fields below.
        _ = candidate

    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="toggle_blind_review",
            resource_type="evaluation",
            resource_id=evaluation.id,
            details={"enabled": payload.enabled},
        )
    )
    db.commit()
    db.refresh(evaluation)

    evidence = (
        db.query(Evidence)
        .filter(Evidence.evaluation_id == evaluation.id)
        .all()
    )
    response = EvaluationResponse.model_validate(evaluation)
    response.evidence = [EvidenceResponse.model_validate(e) for e in evidence]
    return response
