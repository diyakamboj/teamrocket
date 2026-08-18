"""Candidate-population helpers for hiring analytics.

Every aggregate in this feature must be computed from a documented population:

* **Job-scoped evaluated candidates** — rows with an ``Evaluation`` for the
  given ``job_id``, joined to ``Candidate`` via ``Evaluation.candidate_id``.
  This is the population for skill frequencies, experience buckets, coverage %,
  drop-off attribution, pipeline stages, and candidate sources.

* **Full talent pool** — ``Candidate`` rows with no job filter. Do **not** use
  this for JD recommendations; that was the original ``get_insights`` bug.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.candidate import Candidate
from app.models.evaluation import Evaluation


def job_evaluated_population(
    db: Session,
    job_id: UUID,
) -> tuple[list[Evaluation], list[Candidate], dict[UUID, Candidate]]:
    """Return evaluations and candidates actually scored against ``job_id``."""
    evaluations = db.query(Evaluation).filter(Evaluation.job_id == job_id).all()
    if not evaluations:
        return [], [], {}
    candidate_ids = [evaluation.candidate_id for evaluation in evaluations]
    candidates = db.query(Candidate).filter(Candidate.id.in_(candidate_ids)).all()
    by_id = {candidate.id: candidate for candidate in candidates}
    return evaluations, candidates, by_id
