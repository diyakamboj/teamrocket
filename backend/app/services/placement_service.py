"""Moving candidates through a job's pipeline.

One entry point, `move_candidate`, so the board, the pipeline overview and
any future caller all go through the same validation: the stage must exist,
a round must belong to *this* job's loop, and the mover must be allowed to
move this candidate.

Who may move: the job's owner, or a recruiter the candidate was shared with
at "collaborate" permission. That second case is what lets two recruiters
work one candidate — see `app/models/collaboration.py`.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from app.models.job_posting import JobPosting
from app.models.placement import STAGE_ORDER, CandidatePlacement
from app.models.roles import label_for
from app.services import auth_service, handoff_service
from app.storage.store import Store
from app.utils.error_handlers import AppError, ValidationAppError


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize(email: str | None) -> str:
    return (email or "").strip().lower()


def actor_snapshot(store: Store, email: str | None) -> tuple[str | None, str | None, str | None]:
    """Email, display name and role label for whoever just moved a candidate.

    The board shows the name and role ("fardeen · IT Admin") so another
    recruiter can see who acted. Falls back to the local part of the address
    when the actor has no account yet.
    """
    actor = _normalize(email)
    if not actor:
        return None, None, None
    user = auth_service.find_by_email(store, actor)
    if user:
        return user.email, user.name, label_for(user.role)
    return actor, actor.split("@")[0], None


def may_move(store: Store, job: JobPosting, candidate_id: str, actor_email: str) -> bool:
    """True if `actor_email` can move this candidate in this job's pipeline."""
    actor = _normalize(actor_email)
    if _normalize(job.created_by) == actor:
        return True
    # A collaborator on the candidate can move them in the owner's pipeline.
    return any(
        str(share.candidate_id) == str(candidate_id)
        and _normalize(share.shared_with_email) == actor
        and share.allows_collaboration()
        for share in store.candidate_shares.list_all()
    )


def _resolve_round(
    job: JobPosting, stage: str, round_id: Optional[str]
) -> tuple[Optional[str], Optional[int]]:
    """Validate the requested round against the job's loop.

    Only "interviewing" carries a round; every other stage clears it, so a
    candidate can never read as "selected, round 2".
    """
    if stage != "interviewing":
        return None, None
    rounds = job.rounds or []
    if not rounds:
        return None, None
    if round_id is None:
        # Entering the loop without naming a round starts at the first one.
        first = min(rounds, key=lambda r: r.sequence)
        return first.id, first.sequence
    match = next((r for r in rounds if r.id == round_id), None)
    if match is None:
        raise ValidationAppError(
            "That round is not part of this job's interview loop.",
            {"round_id": round_id, "job_id": str(job.id)},
        )
    return match.id, match.sequence


def get_placement(
    store: Store, job_id: uuid.UUID, candidate_id: str
) -> Optional[CandidatePlacement]:
    return store.candidate_placements.get(CandidatePlacement.id_for(job_id, candidate_id))


def move_candidate(
    store: Store,
    *,
    job: JobPosting,
    candidate_id: str,
    candidate_name: str,
    stage: str,
    round_id: Optional[str] = None,
    actor_email: str,
    note: Optional[str] = None,
) -> CandidatePlacement:
    """Place a candidate at `stage` (and `round_id`) in this job's pipeline."""
    if stage not in STAGE_ORDER:
        raise ValidationAppError(
            f"stage must be one of {', '.join(STAGE_ORDER)}",
            {"stage": stage},
        )
    if not may_move(store, job, candidate_id, actor_email):
        raise AppError(
            "You can only move candidates on your own jobs, or ones shared with you to collaborate on.",
            status_code=403,
            details={"candidate_id": str(candidate_id), "job_id": str(job.id)},
        )

    resolved_round_id, resolved_sequence = _resolve_round(job, stage, round_id)
    existing = get_placement(store, job.id, candidate_id)
    previous_stage = existing.stage if existing else None
    actor_email_norm, actor_name, actor_role = actor_snapshot(store, actor_email)

    placement = CandidatePlacement.create(
        job_id=job.id,
        candidate_id=str(candidate_id),
        candidate_name=candidate_name,
        stage=stage,
        round_id=resolved_round_id,
        round_sequence=resolved_sequence,
        moved_by=actor_email_norm,
        moved_by_name=actor_name,
        moved_by_role=actor_role,
        note=(note or "").strip() or None,
        # Keep the original creation time when re-moving someone.
        created_at=existing.created_at if existing else _utcnow(),
        updated_at=_utcnow(),
    )
    store.candidate_placements.save(placement)

    round_label = ""
    if resolved_round_id:
        name = next((r.name for r in (job.rounds or []) if r.id == resolved_round_id), None)
        round_label = f" ({name})" if name else ""
    handoff_service.log_history_event(
        store,
        candidate_id=str(candidate_id),
        candidate_name=candidate_name,
        job_id=str(job.id),
        job_title=job.title,
        event_type="pipeline_moved",
        actor_email=actor_email,
        summary=(
            f"Moved from {previous_stage} to {stage}{round_label}"
            if previous_stage
            else f"Placed in {stage}{round_label}"
        ),
        details={
            "job_id": str(job.id),
            "from_stage": previous_stage,
            "to_stage": stage,
            "round_id": resolved_round_id,
        },
    )
    return placement
