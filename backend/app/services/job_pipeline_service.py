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
from app.storage.store import Store

__all__ = [
    "STAGE_ORDER",
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
        for candidate_id in set(by_candidate_id) | set(placements_by_candidate):
            candidate = store.candidates.get(candidate_id)
            if candidate is None:
                continue
            counted += 1
            if candidate.source == "internal":
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
    scored_ids = {str(e.candidate_id) for e in evaluations}
    by_candidate_id: dict[str, Any] = {str(e.candidate_id): e for e in evaluations}
    candidate_ids = list(scored_ids | set(placements_by_candidate))

    results: list[dict[str, Any]] = []
    for candidate_id in candidate_ids:
        candidate = store.candidates.get(candidate_id)
        if candidate is None:
            continue
        if source and source != "all" and candidate.source != source:
            continue
        evaluation = by_candidate_id.get(candidate_id)
        placement = placements_by_candidate.get(candidate_id)
        stage = _stage_for(
            decisions_by_candidate.get(candidate_id),
            handoffs_by_candidate.get(candidate_id, []),
            placement,
        )
        results.append(
            {
                "candidate_id": candidate.id,
                "candidate_name": candidate.name,
                "candidate_email": candidate.email,
                "source": candidate.source,
                "employment_status": candidate.employment_status,
                "overall_score": float(evaluation.overall_score)
                if evaluation is not None and evaluation.overall_score is not None
                else None,
                "stage": stage,
                "round_id": placement.round_id if placement else None,
                "round_name": round_names.get(placement.round_id) if placement else None,
                "round_sequence": placement.round_sequence if placement else None,
                "moved_by": placement.moved_by if placement else None,
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
    evaluations = store.evaluations.list_for_job(job_id)
    decisions_by_candidate = _latest_decisions_by_candidate(store, job.title)
    handoffs_by_candidate = _handoffs_by_candidate(store, job.id)
    placements_by_candidate = _placements_by_candidate(store, job.id)
    evaluated_ids = {str(e.candidate_id) for e in evaluations}
    for candidate_id in evaluated_ids | set(placements_by_candidate):
        candidate = store.candidates.get(candidate_id)
        if candidate is None:
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

