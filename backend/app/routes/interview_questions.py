"""Question banks for a job's interview rounds."""

import uuid
from typing import Optional

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool

from app.dependencies import AppStore, RecruiterEmail
from app.models.interview_questions import Audience, Difficulty, RoundQuestionSet
from app.services import interview_question_service
from app.utils.error_handlers import NotFoundError
from app.utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


def _job_or_404(store, job_id: uuid.UUID, recruiter_email: str):
    job = store.jobs.get(job_id)
    # 404 rather than 403 for someone else's job: an id should not be
    # confirmable by a recruiter who does not own it.
    if not job or (job.created_by and job.created_by != recruiter_email):
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})
    return job


def _round_or_404(job, round_id: str):
    for round_ in job.rounds or []:
        if round_.id == round_id:
            return round_
    raise NotFoundError("Interview round not found", {"round_id": round_id})


@router.get("/{job_id}/rounds/{round_id}/questions", response_model=Optional[RoundQuestionSet])
def get_round_questions(
    job_id: uuid.UUID,
    round_id: str,
    store: AppStore,
    recruiter_email: RecruiterEmail,
    audience: Optional[Audience] = Query(None),
    difficulty: Optional[Difficulty] = Query(None),
):
    """The stored bank for a round, or null if it has not been generated."""
    _job_or_404(store, job_id, recruiter_email)
    existing = _stored_set(store, job_id, round_id)
    if existing is None:
        return None
    return _filtered(existing, audience, difficulty)


@router.post("/{job_id}/rounds/{round_id}/questions", response_model=RoundQuestionSet)
async def generate_round_questions(
    job_id: uuid.UUID,
    round_id: str,
    store: AppStore,
    recruiter_email: RecruiterEmail,
    refresh: bool = Query(False, description="Regenerate even if a bank already exists"),
):
    """Generate (or reuse) the question bank for one round.

    Reuses what is stored unless `refresh` is set, so opening a round does
    not spend a model call every time.
    """
    job = _job_or_404(store, job_id, recruiter_email)
    round_ = _round_or_404(job, round_id)

    if not refresh:
        existing = _stored_set(store, job_id, round_id)
        if existing is not None:
            return existing

    question_set = await run_in_threadpool(
        interview_question_service.generate_for_round, job, round_
    )

    # One bank per round: regenerating replaces rather than accumulating.
    previous = _stored_set(store, job_id, round_id)
    if previous is not None:
        question_set.id = previous.id
        store.round_questions.delete(previous.id)
    store.round_questions.save(question_set)
    return question_set


@router.post("/{job_id}/questions", response_model=list[RoundQuestionSet])
async def generate_all_round_questions(
    job_id: uuid.UUID,
    store: AppStore,
    recruiter_email: RecruiterEmail,
    refresh: bool = Query(False),
):
    """Populate every round of this job's loop in one go."""
    job = _job_or_404(store, job_id, recruiter_email)
    sets: list[RoundQuestionSet] = []
    for round_ in sorted(job.rounds or [], key=lambda r: r.sequence):
        if not refresh:
            existing = _stored_set(store, job_id, round_.id)
            if existing is not None:
                sets.append(existing)
                continue
        generated = await run_in_threadpool(
            interview_question_service.generate_for_round, job, round_
        )
        previous = _stored_set(store, job_id, round_.id)
        if previous is not None:
            generated.id = previous.id
            store.round_questions.delete(previous.id)
        store.round_questions.save(generated)
        sets.append(generated)
    return sets


def _stored_set(store, job_id: uuid.UUID, round_id: str) -> Optional[RoundQuestionSet]:
    rows = store.round_questions.query(
        lambda q: str(q.job_id) == str(job_id) and q.round_id == round_id
    )
    return rows[0] if rows else None


def _filtered(
    question_set: RoundQuestionSet,
    audience: Optional[Audience],
    difficulty: Optional[Difficulty],
) -> RoundQuestionSet:
    questions = question_set.questions
    if audience is not None:
        questions = [q for q in questions if q.audience == audience]
    if difficulty is not None:
        questions = [q for q in questions if q.difficulty == difficulty]
    return question_set.model_copy(update={"questions": questions})
