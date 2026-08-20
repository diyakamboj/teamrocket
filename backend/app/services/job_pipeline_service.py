"""Top-level recruiter dashboard: active job listings + pipeline stage tracking.

A candidate's stage comes from a `CandidatePlacement` when one exists — the
recruiter moved them, and that explicit position wins over anything inferred.

Absent a placement, stage is derived the original way, from data that already
exists: an Evaluation means the candidate has been screened for the job, an
InterviewHandoff means an interview briefing went out, and a CandidateDecision
is the recruiter's approve/reject call. Derivation is what a candidate nobody
has moved yet still reads as, so pipelines that predate placements keep
working without a backfill.

CandidateDecision has no job_id column (it predates jobs having real
pipelines — see its docstring), so *derived* stages match decisions to a job
by title. This is best-effort, not a guarantee; a placement is job-scoped and
has no such ambiguity, which is the other reason moves write one.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Optional
from uuid import UUID

from app.models.evaluation import CandidateDecision
from app.models.handoff import InterviewHandoff
from app.models.job_posting import JobPosting
from app.models.placement import STAGE_ORDER, CandidatePlacement
from app.services.placement_service import actor_snapshot
from app.storage.store import Store

__all__ = [
    "STAGE_ORDER",
    "candidate_ids_for_job",
    "rankable_candidate_ids_for_job",
    "hired_candidates_for_job",
    "get_job_pipeline_summaries",
    "get_job_pipeline_candidates",
    "job_pipeline_progression",
    "job_candidate_sources",
]


def _latest_decisions_by_candidate(store: Store, job_title: str) -> dict[str, CandidateDecision]:
    decisions = sorted(
        store.candidate_decisions.query(lambda d: d.job_title == job_title),
        key=lambda d: d.created_at,
    )
    by_candidate: dict[str, CandidateDecision] = {}
    for decision in decisions:
        by_candidate[decision.candidate_id] = decision  # last one wins
    return by_candidate


def _handoffs_by_candidate(store: Store, job_id: UUID) -> dict[str, list[InterviewHandoff]]:
    rows = store.handoffs.query(lambda h: h.job_id == str(job_id))
    grouped: dict[str, list[InterviewHandoff]] = defaultdict(list)
    for handoff in rows:
        grouped[handoff.candidate_id].append(handoff)
    return grouped


def candidate_ids_for_job(store: Store, job: JobPosting) -> set[str]:
    """Who belongs on this job's board.

    Three ways in, and evaluation is deliberately not one of them:

      * the résumé was uploaded against this role (`candidate.job_id`)
      * a recruiter placed them here explicitly (a `CandidatePlacement`)
      * they were scored here *and* belong to no other role, which keeps
        candidates added before uploads carried a job from vanishing

    Membership used to be "has an evaluation for this job", but ranking a job
    scores the whole pool, so one click put every candidate on every board.
    A candidate uploaded for Backend Engineer would appear under Platform
    Engineer too, which is what made the boards meaningless.
    """
    owner = job.created_by
    mine = store.candidates.query(
        lambda c: c.owner_email == owner if owner else True
    )

    belongs: set[str] = set()
    unassigned: set[str] = set()
    excluded: set[str] = {
        str(c.id)
        for c in mine
        if any(str(x) == str(job.id) for x in (c.excluded_job_ids or []))
    }
    for candidate in mine:
        if candidate.job_id is not None and str(candidate.job_id) == str(job.id):
            belongs.add(str(candidate.id))
        elif candidate.job_id is None:
            unassigned.add(str(candidate.id))

    belongs.update(str(p.candidate_id) for p in store.candidate_placements.query(
        lambda p: str(p.job_id) == str(job.id)
    ))

    # Pool candidates -- uploaded without a role, or added before uploads
    # carried one -- join a board once they have been scored against it.
    # A candidate owned by a *different* role never does, whatever their
    # evaluations say.
    scored = {str(e.candidate_id) for e in store.evaluations.list_for_job(job.id)}
    belongs.update(scored & unassigned)
    # An explicit removal wins over every route back in.
    return belongs - excluded


def hired_candidates_for_job(store: Store, job: JobPosting) -> list:
    """Everyone hired into this role.

    Kept deliberately apart from the pipeline: a hired person is no longer a
    candidate to compare or action, but the role still has to show who
    filled it. Matches on the recorded hire when there is one, falling back
    to the role they were uploaded against.
    """
    return store.candidates.query(
        lambda c: c.hiring_status == "hired"
        and (
            (c.hired_for_job_id is not None and str(c.hired_for_job_id) == str(job.id))
            or (c.hired_for_job_id is None and str(c.job_id or "") == str(job.id))
        )
    )


def rankable_candidate_ids_for_job(store: Store, job: JobPosting) -> set[str]:
    """Who may be *scored* against this job.

    Wider than board membership: the job's own candidates plus anyone in the
    general pool who belongs to no role yet. Ranking has to include the
    unassigned, because being scored is how they join a board in the first
    place -- restricting ranking to existing members would mean a pool
    candidate could never enter one.

    Still excludes candidates uploaded for a different role, which is the
    leak that put every candidate on every board.
    """
    owner = job.created_by
    mine = store.candidates.query(lambda c: c.owner_email == owner if owner else True)
    unassigned = {
        str(c.id)
        for c in mine
        if c.job_id is None
        and not any(str(x) == str(job.id) for x in (c.excluded_job_ids or []))
    }
    # Someone already hired or rejected is not an open candidate. Ranking
    # them again is what left a "Hire" button beside a person who had
    # already been hired.
    open_ids = {str(c.id) for c in mine if c.hiring_status == "active"}
    return (candidate_ids_for_job(store, job) | unassigned) & open_ids


def _placements_by_candidate(store: Store, job_id: UUID) -> dict[str, CandidatePlacement]:
    rows = store.candidate_placements.query(lambda p: str(p.job_id) == str(job_id))
    return {str(p.candidate_id): p for p in rows}


def _stage_for(
    decision: Optional[CandidateDecision],
    handoffs: list[InterviewHandoff],
    placement: Optional[CandidatePlacement] = None,
) -> str:
    # An explicit move beats anything inferred from decisions or handoffs.
    if placement and placement.stage in STAGE_ORDER:
        return placement.stage
    if decision and decision.decision == "rejected":
        return "rejected"
    if decision and decision.decision == "hired":
        return "hired"
    if decision and decision.decision == "approved":
        return "selected"
    # Advancing puts the candidate into the interview loop rather than
    # ending it, so it reads as "interviewing" until a handoff says more.
    if decision and decision.decision == "advanced":
        return "interviewing"
    if handoffs:
        if any(h.status == "acknowledged" for h in handoffs):
            return "interviewed"
        return "interviewing"
    return "screened"


def get_job_pipeline_summaries(
    store: Store, recruiter_email: str | None = None
) -> list[dict[str, Any]]:
    """Every job with its pipeline counts, scoped to one recruiter when given.

    Unscoped this returned every job on the deployment, which is how a newly
    registered account saw other people's roles in its sidebar.
    """
    owned = (
        store.jobs.query(lambda j: j.created_by == recruiter_email)
        if recruiter_email
        else store.jobs.list_all()
    )
    jobs = sorted(owned, key=lambda j: j.created_at, reverse=True)
    summaries: list[dict[str, Any]] = []

    for job in jobs:
        evaluations = store.evaluations.list_for_job(job.id)
        decisions_by_candidate = _latest_decisions_by_candidate(store, job.title)
        handoffs_by_candidate = _handoffs_by_candidate(store, job.id)
        placements_by_candidate = _placements_by_candidate(store, job.id)

        stage_counts = {stage: 0 for stage in STAGE_ORDER}
        internal = external = 0
        scores: list[float] = []

        # Same union as `get_job_pipeline_candidates`: someone moved onto this
        # board counts toward it even if they were never scored for the role.
        by_candidate_id = {str(e.candidate_id): e for e in evaluations}
        counted = 0
        for candidate_id in candidate_ids_for_job(store, job):
            candidate = store.candidates.get(candidate_id)
            placement = placements_by_candidate.get(candidate_id)
            if candidate is None and placement is None:
                continue
            counted += 1
            if candidate is not None and candidate.source == "internal":
                internal += 1
            else:
                external += 1
            evaluation = by_candidate_id.get(candidate_id)
            if evaluation is not None and evaluation.overall_score is not None:
                scores.append(float(evaluation.overall_score))
            stage = _stage_for(
                decisions_by_candidate.get(candidate_id),
                handoffs_by_candidate.get(candidate_id, []),
                placements_by_candidate.get(candidate_id),
            )
            stage_counts[stage] += 1

        summaries.append(
            {
                "job_id": job.id,
                "title": job.title,
                "status": job.status,
                "sourcing_mode": getattr(job, "sourcing_mode", "both") or "both",
                "created_at": job.created_at,
                "total_candidates": counted,
                "internal_candidates": internal,
                "external_candidates": external,
                "average_score": round(sum(scores) / len(scores), 2) if scores else 0.0,
                "stage_counts": stage_counts,
            }
        )


    return summaries


def get_job_pipeline_candidates(
    store: Store, job: JobPosting, source: Optional[str] = None
) -> list[dict[str, Any]]:
    evaluations = store.evaluations.list_for_job(job.id)
    decisions_by_candidate = _latest_decisions_by_candidate(store, job.title)
    handoffs_by_candidate = _handoffs_by_candidate(store, job.id)
    placements_by_candidate = _placements_by_candidate(store, job.id)
    round_names = {r.id: r.name for r in (job.rounds or [])}

    # Evaluated candidates, plus anyone placed on this board without one.
    # A recruiter can move a candidate who was never scored against the role;
    # leaving them out here would drop their placement and snap them back to
    # "screened" on the next read.
    by_candidate_id: dict[str, Any] = {str(e.candidate_id): e for e in evaluations}
    candidate_ids = list(candidate_ids_for_job(store, job))

    results: list[dict[str, Any]] = []
    for candidate_id in candidate_ids:
        candidate = store.candidates.get(candidate_id)
        placement = placements_by_candidate.get(candidate_id)
        # A placement outlives the candidate record it points at (deleted,
        # re-imported under a new id, or never persisted). Dropping the row
        # made the board silently revert the move instead of showing it, so
        # an explicitly placed candidate is rendered from the placement.
        if candidate is None and placement is None:
            continue
        if (
            source
            and source != "all"
            and candidate is not None
            and candidate.source != source
        ):
            continue
        evaluation = by_candidate_id.get(candidate_id)
        stage = _stage_for(
            decisions_by_candidate.get(candidate_id),
            handoffs_by_candidate.get(candidate_id, []),
            placement,
        )
        moved_by = placement.moved_by if placement else None
        moved_by_name = placement.moved_by_name if placement else None
        moved_by_role = placement.moved_by_role if placement else None
        if moved_by and not moved_by_name:
            _, moved_by_name, moved_by_role = actor_snapshot(store, moved_by)
        results.append(
            {
                "candidate_id": candidate.id if candidate else candidate_id,
                "candidate_name": (
                    candidate.name
                    if candidate
                    else (placement.candidate_name if placement else None) or "Unknown candidate"
                ),
                "candidate_email": candidate.email if candidate else None,
                "source": candidate.source if candidate else "external",
                "employment_status": candidate.employment_status if candidate else None,
                "overall_score": float(evaluation.overall_score)
                if evaluation is not None and evaluation.overall_score is not None
                else None,
                "stage": stage,
                "round_id": placement.round_id if placement else None,
                "round_name": round_names.get(placement.round_id) if placement else None,
                "round_sequence": placement.round_sequence if placement else None,
                "moved_by": moved_by,
                "moved_by_name": moved_by_name,
                "moved_by_role": moved_by_role,
                "updated_at": placement.updated_at
                if placement
                else (evaluation.created_at if evaluation else job.created_at),
            }
        )

    results.sort(key=lambda r: (r["overall_score"] is None, -(r["overall_score"] or 0)))
    return results


def job_pipeline_progression(store: Store, job_id: UUID) -> dict[str, int]:
    """Hiring-process stages for evaluated candidates on this job.

    Uses the same derivation as the recruiter dashboard (evaluation + handoff
    + approve/reject), not a separate persisted stage column.
    """
    job = store.jobs.get(job_id)
    counts = {stage: 0 for stage in STAGE_ORDER}
    if not job:
        return counts
    decisions_by_candidate = _latest_decisions_by_candidate(store, job.title)
    handoffs_by_candidate = _handoffs_by_candidate(store, job.id)
    placements_by_candidate = _placements_by_candidate(store, job.id)
    for candidate_id in candidate_ids_for_job(store, job):
        candidate = store.candidates.get(candidate_id)
        if candidate is None and candidate_id not in placements_by_candidate:
            continue
        stage = _stage_for(
            decisions_by_candidate.get(candidate_id),
            handoffs_by_candidate.get(candidate_id, []),
            placements_by_candidate.get(candidate_id),
        )
        counts[stage] += 1
    return counts


def job_candidate_sources(candidates: list) -> dict[str, int]:
    """Internal vs external breakdown. Population: job-scoped evaluated candidates."""
    counts = {"internal": 0, "external": 0}
    for candidate in candidates:
        source = (getattr(candidate, "source", None) or "external").lower()
        if source not in counts:
            counts[source] = 0
        counts[source] += 1
    return counts

