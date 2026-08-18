"""Top-level recruiter dashboard: active job listings + pipeline stage tracking.

There is no dedicated "pipeline stage" or "application" table in this app —
stage is derived from data that already exists: an Evaluation means the
candidate has been screened for the job, an InterviewHandoff means an
interview briefing went out, and a CandidateDecision is the recruiter's
approve/reject call. This keeps the dashboard consistent with the rest of
the app (Candidate Ranking, Interview Handoff) instead of introducing a
second, easily-out-of-sync source of truth.

CandidateDecision has no job_id column (it predates jobs having real
pipelines — see its docstring), so decisions are matched to a job by title.
This is a best-effort match, not a guarantee, given the existing schema.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Optional
from uuid import UUID

from app.models.evaluation import CandidateDecision
from app.models.handoff import InterviewHandoff
from app.models.job_posting import JobPosting
from app.storage.store import Store

STAGE_ORDER = ["screened", "interviewing", "interviewed", "selected", "rejected"]


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


def _stage_for(
    decision: Optional[CandidateDecision], handoffs: list[InterviewHandoff]
) -> str:
    if decision and decision.decision == "rejected":
        return "rejected"
    if decision and decision.decision == "approved":
        return "selected"
    if handoffs:
        if any(h.status == "acknowledged" for h in handoffs):
            return "interviewed"
        return "interviewing"
    return "screened"


def get_job_pipeline_summaries(store: Store) -> list[dict[str, Any]]:
    jobs = sorted(store.jobs.list_all(), key=lambda j: j.created_at, reverse=True)
    summaries: list[dict[str, Any]] = []

    for job in jobs:
        evaluations = store.evaluations.list_for_job(job.id)
        decisions_by_candidate = _latest_decisions_by_candidate(store, job.title)
        handoffs_by_candidate = _handoffs_by_candidate(store, job.id)

        stage_counts = {stage: 0 for stage in STAGE_ORDER}
        internal = external = 0
        scores: list[float] = []

        for evaluation in evaluations:
            candidate = store.candidates.get(evaluation.candidate_id)
            if candidate is None:
                continue
            if candidate.source == "internal":
                internal += 1
            else:
                external += 1
            if evaluation.overall_score is not None:
                scores.append(float(evaluation.overall_score))
            stage = _stage_for(
                decisions_by_candidate.get(str(candidate.id)),
                handoffs_by_candidate.get(str(candidate.id), []),
            )
            stage_counts[stage] += 1

        summaries.append(
            {
                "job_id": job.id,
                "title": job.title,
                "status": job.status,
                "created_at": job.created_at,
                "total_candidates": len(evaluations),
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

    results: list[dict[str, Any]] = []
    for evaluation in evaluations:
        candidate = store.candidates.get(evaluation.candidate_id)
        if candidate is None:
            continue
        if source and source != "all" and candidate.source != source:
            continue
        stage = _stage_for(
            decisions_by_candidate.get(str(candidate.id)),
            handoffs_by_candidate.get(str(candidate.id), []),
        )
        results.append(
            {
                "candidate_id": candidate.id,
                "candidate_name": candidate.name,
                "candidate_email": candidate.email,
                "source": candidate.source,
                "employment_status": candidate.employment_status,
                "overall_score": float(evaluation.overall_score)
                if evaluation.overall_score is not None
                else None,
                "stage": stage,
                "updated_at": evaluation.created_at,
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
    for evaluation in evaluations:
        candidate = store.candidates.get(evaluation.candidate_id)
        if candidate is None:
            continue
        stage = _stage_for(
            decisions_by_candidate.get(str(candidate.id)),
            handoffs_by_candidate.get(str(candidate.id), []),
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

