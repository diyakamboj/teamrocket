"""Candidate-population helpers for hiring analytics.

Every aggregate in this feature must be computed from a documented population:

* **Job-scoped evaluated candidates** — evaluations for the given ``job_id``,
  joined to ``Candidate`` via ``Evaluation.candidate_id``. This is the
  population for skill frequencies, experience buckets, coverage %, drop-off,
  pipeline stages, and candidate sources.

* **Full talent pool** — ``store.candidates.list_all()``. Do **not** use this
  for JD recommendations.
"""

from __future__ import annotations

from uuid import UUID

from app.models.candidate import Candidate
from app.models.evaluation import Evaluation
from app.storage.store import Store


def job_evaluated_population(
    store: Store,
    job_id: UUID,
) -> tuple[list[Evaluation], list[Candidate], dict[UUID, Candidate]]:
    """Return evaluations and candidates actually scored against ``job_id``."""
    evaluations = store.evaluations.list_for_job(job_id)
    if not evaluations:
        return [], [], {}
    by_id: dict[UUID, Candidate] = {}
    candidates: list[Candidate] = []
    for evaluation in evaluations:
        candidate = store.candidates.get(evaluation.candidate_id)
        if candidate is None or candidate.id in by_id:
            continue
        by_id[candidate.id] = candidate
        candidates.append(candidate)
    return evaluations, candidates, by_id
