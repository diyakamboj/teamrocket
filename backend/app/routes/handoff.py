import uuid
from typing import Optional

from fastapi import APIRouter, Query

from app.dependencies import AppStore, RecruiterEmail
from app.models.schemas import (
    BriefingScorecard,
    CandidateBriefing,
    CandidateHistoryEventResponse,
    HandoffAcknowledgeRequest,
    HandoffCreateRequest,
    HandoffResponse,
)
from app.services import handoff_service
from app.utils.error_handlers import NotFoundError

router = APIRouter()


@router.get("/history/{candidate_id}", response_model=list[CandidateHistoryEventResponse])
def get_candidate_history(
    candidate_id: str,
    store: AppStore,
    job_id: Optional[str] = Query(default=None),
):
    """Centralized log of everything that happened to this candidate's evaluation."""
    return handoff_service.get_history(store, candidate_id, job_id)


@router.get("/briefing/{candidate_id}/{job_id}", response_model=CandidateBriefing)
def preview_briefing(candidate_id: uuid.UUID, job_id: uuid.UUID, store: AppStore):
    """Auto-build a briefing preview from a persisted Evaluation, when one exists.

    Only works for candidates/jobs that live in the backend store. The
    ranking UI can also show client-side/demo candidates — for those, the
    recruiter fills in the briefing fields by hand on the handoff form
    instead.
    """
    candidate = store.candidates.get(candidate_id)
    job = store.jobs.get(job_id)
    if not candidate or not job:
        raise NotFoundError(
            "Candidate or job not found", {"candidate_id": str(candidate_id), "job_id": str(job_id)}
        )
    evaluation = store.evaluations.get_for(job_id, candidate_id)
    if not evaluation:
        raise NotFoundError(
            "No evaluation on file for this candidate/job yet",
            {"candidate_id": str(candidate_id), "job_id": str(job_id)},
        )

    scorecard = BriefingScorecard(
        overall_score=float(evaluation.overall_score) if evaluation.overall_score is not None else None,
        skill_score=float(evaluation.skill_match_score) if evaluation.skill_match_score is not None else None,
        experience_score=float(evaluation.experience_match_score)
        if evaluation.experience_match_score is not None
        else None,
        education_score=float(evaluation.education_match_score)
        if evaluation.education_match_score is not None
        else None,
        certification_score=float(evaluation.certification_match_score)
        if evaluation.certification_match_score is not None
        else None,
        project_score=float(evaluation.project_match_score) if evaluation.project_match_score is not None else None,
    )
    return handoff_service.build_briefing(
        candidate_id=str(candidate.id),
        candidate_name=candidate.name,
        candidate_email=candidate.email,
        job_id=str(job.id),
        job_title=job.title,
        scorecard=scorecard,
        matched_skills=evaluation.matched_skills or [],
        missing_skills=evaluation.missing_skills or [],
        strengths=evaluation.strengths,
        weaknesses=evaluation.weaknesses,
        transferable_skills=evaluation.transferable_skills,
        evidence_highlights=[],
        recruiter_notes=None,
    )


@router.post("", response_model=HandoffResponse)
def create_handoff(
    payload: HandoffCreateRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    return handoff_service.create_handoff(store, payload, recruiter_email)


@router.get("/candidate/{candidate_id}/list", response_model=list[HandoffResponse])
def list_handoffs_for_candidate(candidate_id: str, store: AppStore):
    return handoff_service.list_handoffs_for_candidate(store, candidate_id)


@router.get("/{handoff_id}", response_model=HandoffResponse)
def get_handoff(handoff_id: uuid.UUID, store: AppStore):
    handoff = store.handoffs.get(handoff_id)
    if not handoff:
        raise NotFoundError("Handoff not found", {"handoff_id": str(handoff_id)})
    return handoff


@router.post("/{handoff_id}/view", response_model=HandoffResponse)
def view_handoff(handoff_id: uuid.UUID, store: AppStore):
    """Called by the interviewer briefing page on load — flips pending -> viewed."""
    handoff = store.handoffs.get(handoff_id)
    if not handoff:
        raise NotFoundError("Handoff not found", {"handoff_id": str(handoff_id)})
    return handoff_service.mark_viewed(store, handoff)


@router.post("/{handoff_id}/acknowledge", response_model=HandoffResponse)
def acknowledge_handoff(
    handoff_id: uuid.UUID,
    payload: HandoffAcknowledgeRequest,
    store: AppStore,
):
    handoff = store.handoffs.get(handoff_id)
    if not handoff:
        raise NotFoundError("Handoff not found", {"handoff_id": str(handoff_id)})
    return handoff_service.acknowledge_handoff(store, handoff, payload.interviewer_notes)
