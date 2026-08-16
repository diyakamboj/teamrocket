import uuid
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool

from app.dependencies import DbSession, RecruiterEmail
from app.models.evaluation import AuditLog
from app.models.schemas import (
    ScreeningAnswerRequest,
    ScreeningSessionResponse,
    ScreeningSessionSummary,
    ScreeningStartRequest,
)
from app.services.screening_service import screening_service

router = APIRouter()


def _summary(session) -> ScreeningSessionSummary:
    scorecard = session.scorecard or {}
    answered = len([t for t in (session.turns or []) if t.get("evaluation")])
    return ScreeningSessionSummary(
        session_id=session.id,
        candidate_id=session.candidate_id,
        candidate_name=session.candidate_name,
        job_title=session.job_title,
        status=session.status,
        question_count=len(session.plan or []),
        answered_count=answered,
        overall_score=scorecard.get("overall_score"),
        recommendation=scorecard.get("recommendation"),
        created_at=session.created_at,
        completed_at=session.completed_at,
    )


@router.post("/sessions", response_model=ScreeningSessionResponse)
async def start_screening(
    payload: ScreeningStartRequest,
    db: DbSession,
    recruiter_email: RecruiterEmail,
):
    """Open an L1 screening session and generate its question plan."""
    session = await run_in_threadpool(
        screening_service.start_session,
        db,
        recruiter_email=recruiter_email,
        candidate_id=payload.candidate_id,
        job_id=payload.job_id,
        profile=(
            {
                "candidate": payload.candidate.model_dump(),
                "job": payload.job.model_dump() if payload.job else {},
            }
            if payload.candidate
            else None
        ),
        question_count=payload.question_count,
    )
    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="screening_started",
            resource_type="screening_session",
            resource_id=session.id,
            details={
                "candidate_id": session.candidate_id,
                "job_title": session.job_title,
                "questions": len(session.plan or []),
            },
        )
    )
    db.commit()
    return screening_service.to_payload(session)


@router.get("/sessions", response_model=list[ScreeningSessionSummary])
def list_screening_sessions(
    db: DbSession,
    recruiter_email: RecruiterEmail,
    mine_only: bool = Query(True),
    candidate_id: Optional[str] = Query(None),
):
    sessions = screening_service.list_sessions(
        db,
        recruiter_email=recruiter_email if mine_only else None,
        candidate_id=candidate_id,
    )
    return [_summary(s) for s in sessions]


@router.get("/sessions/{session_id}", response_model=ScreeningSessionResponse)
def get_screening_session(session_id: uuid.UUID, db: DbSession):
    return screening_service.to_payload(screening_service.get_session(db, session_id))


@router.post("/sessions/{session_id}/answer", response_model=ScreeningSessionResponse)
async def answer_screening_question(
    session_id: uuid.UUID,
    payload: ScreeningAnswerRequest,
    db: DbSession,
):
    """Record an answer, score it, and hand back the next question."""
    session = await run_in_threadpool(
        screening_service.submit_answer,
        db,
        session_id=session_id,
        answer=payload.answer,
    )
    return screening_service.to_payload(session)


@router.post("/sessions/{session_id}/skip", response_model=ScreeningSessionResponse)
async def skip_screening_question(session_id: uuid.UUID, db: DbSession):
    session = await run_in_threadpool(
        screening_service.skip_question, db, session_id=session_id
    )
    return screening_service.to_payload(session)


@router.post("/sessions/{session_id}/complete", response_model=ScreeningSessionResponse)
async def complete_screening_session(
    session_id: uuid.UUID,
    db: DbSession,
    recruiter_email: RecruiterEmail,
):
    """End the screen early and generate the briefing from what was answered."""
    session = await run_in_threadpool(
        screening_service.complete_session, db, session_id=session_id
    )
    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="screening_completed",
            resource_type="screening_session",
            resource_id=session.id,
            details={
                "candidate_id": session.candidate_id,
                "overall_score": (session.scorecard or {}).get("overall_score"),
                "recommendation": (session.scorecard or {}).get("recommendation"),
            },
        )
    )
    db.commit()
    return screening_service.to_payload(session)


@router.get("/sessions/{session_id}/briefing")
def get_screening_briefing(session_id: uuid.UUID, db: DbSession):
    """Pre-interview briefing. Generated on demand if the screen is still open."""
    session = screening_service.get_session(db, session_id)
    briefing = dict(session.briefing or {})
    if not briefing:
        session = screening_service.complete_session(db, session_id=session_id)
        briefing = dict(session.briefing or {})
    return {
        "session_id": session.id,
        "candidate_id": session.candidate_id,
        "candidate_name": session.candidate_name,
        "job_title": session.job_title,
        "status": session.status,
        "briefing": briefing,
    }
