import uuid
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter

from app.dependencies import AppStore, RecruiterEmail
from app.models.screening import ScreeningSession
from app.services.screening_service import screening_service

router = APIRouter()


class CreateScreeningSessionRequest(BaseModel):
    candidate_id: uuid.UUID
    job_id: Optional[uuid.UUID] = None


class SubmitAnswerRequest(BaseModel):
    session_id: uuid.UUID
    question_id: str
    answer_text: str


@router.post("/session", response_model=ScreeningSession)
def create_screening_session(
    payload: CreateScreeningSessionRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Initiates an L1 preliminary screening session for a candidate."""
    return screening_service.create_session(
        store,
        candidate_id=payload.candidate_id,
        job_id=payload.job_id,
    )


@router.post("/answer", response_model=ScreeningSession)
def submit_screening_answer(
    payload: SubmitAnswerRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Submits a candidate's answer to a preliminary screening question."""
    return screening_service.submit_answer(
        store,
        session_id=payload.session_id,
        question_id=payload.question_id,
        answer_text=payload.answer_text,
    )


@router.get("/candidate/{candidate_id}", response_model=list[ScreeningSession])
def list_candidate_screening_sessions(
    candidate_id: uuid.UUID,
    store: AppStore,
):
    """Retrieves all screening sessions and summary packs for a candidate."""
    return screening_service.get_candidate_sessions(store, candidate_id=candidate_id)
