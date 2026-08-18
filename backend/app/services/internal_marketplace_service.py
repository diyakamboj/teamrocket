"""Internal talent marketplace: match bench/internal candidates against a job.

Pure additive reuse of the existing scoring engine (`CandidateMatcher`) and
the Copilot verdict-and-explanation machinery (`copilot_pool`/
`copilot_agent`, built for the recent Copilot upgrade) — no new scoring or
explanation logic here, just wiring plus the bench-priority sort boost.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.models.schemas import AgentEvaluationSummary
from app.services.candidate_matcher import DEFAULT_WEIGHTS, bench_sort_key, candidate_matcher
from app.services.copilot_agent import get_verdicts
from app.services.copilot_pool import build_pool, job_requirements
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError


async def get_internal_matches(
    store: Store,
    job_id: UUID,
    bench_priority: bool = True,
    persist: bool = True,
) -> list[AgentEvaluationSummary]:
    job = store.jobs.get(job_id)
    if not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

    ranked = await candidate_matcher.rank_candidates(
        store, job_id, persist=persist, source="internal", bench_priority=bench_priority
    )
    requirements = job_requirements(job)
    pool = build_pool(ranked, weights=DEFAULT_WEIGHTS, blind=False, requirements=requirements)

    # build_pool() re-sorts its output by its own recomputed score (confirmed:
    # `pool.sort(key=lambda c: (-c["score"], c["label"]))`), which discards
    # bench ordering — re-attach bench metadata and re-apply the SAME
    # bench_sort_key after.
    meta_by_id = {str(item["candidate_id"]): item for item in ranked}
    for member in pool:
        meta = meta_by_id.get(member["id"], {})
        member["source"] = meta.get("source")
        member["employment_status"] = meta.get("employment_status")
        member["current_assignment"] = meta.get("current_assignment")

    if bench_priority:
        pool.sort(key=lambda c: bench_sort_key(c["score"], c.get("employment_status"), c["label"]))

    results: list[AgentEvaluationSummary] = []
    for member in pool:
        verdict_result = get_verdicts(pool, requirements, {"candidateId": member["id"]})
        summary = AgentEvaluationSummary(**verdict_result["structured"])
        summary.candidate.source = member.get("source")
        summary.candidate.employment_status = member.get("employment_status")
        summary.candidate.current_assignment = member.get("current_assignment")
        results.append(summary)
    return results
