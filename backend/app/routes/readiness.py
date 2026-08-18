import uuid
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, Query

from app.dependencies import AppStore, RecruiterEmail
from app.models.readiness import AssessmentRecommendation, AssessmentType, CandidateAssessmentRecord
from app.services.readiness_service import readiness_service

router = APIRouter()


class TriggerAssessmentRequest(BaseModel):
    candidate_id: uuid.UUID
    job_id: Optional[uuid.UUID] = None
    assessment_type: AssessmentType = "technical_depth"
    target_competency: str = "Technical & Domain Knowledge"
    recommendation_reason: str = "Recruiter-approved readiness assessment"


class SubmitResultsRequest(BaseModel):
    score: float
    result_summary: str


@router.get("/evaluate/{candidate_id}", response_model=AssessmentRecommendation)
async def evaluate_candidate_readiness(
    candidate_id: uuid.UUID,
    store: AppStore,
    job_id: Optional[uuid.UUID] = Query(None),
):
    """Evaluates candidate qualifications and recommends readiness/aptitude assessment needs."""
    return await readiness_service.evaluate_readiness(
        store,
        candidate_id=candidate_id,
        job_id=job_id,
    )


@router.post("/trigger", response_model=CandidateAssessmentRecord)
def trigger_candidate_assessment(
    payload: TriggerAssessmentRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Triggers an assessment notification after recruiter review and explicit approval."""
    return readiness_service.trigger_assessment(
        store,
        candidate_id=payload.candidate_id,
        job_id=payload.job_id,
        assessment_type=payload.assessment_type,
        target_competency=payload.target_competency,
        recommendation_reason=payload.recommendation_reason,
        recruiter_email=recruiter_email,
    )


@router.post("/{assessment_id}/results", response_model=CandidateAssessmentRecord)
def submit_assessment_results(
    assessment_id: uuid.UUID,
    payload: SubmitResultsRequest,
    store: AppStore,
):
    """Submits candidate assessment scores and summary results."""
    return readiness_service.submit_assessment_results(
        store,
        assessment_id=assessment_id,
        score=payload.score,
        result_summary=payload.result_summary,
    )


@router.get("/candidate/{candidate_id}", response_model=list[CandidateAssessmentRecord])
def list_candidate_assessments(
    candidate_id: uuid.UUID,
    store: AppStore,
):
    """Retrieves all assessment records and status history for a candidate."""
    return readiness_service.get_candidate_assessments(store, candidate_id=candidate_id)
