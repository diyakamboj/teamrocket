"""One-off cleanup: wipe the entire synthetic/dummy candidate pool.

This app has no per-job candidate scoping — every job's "Candidates" tab
re-scores and re-persists Evaluations against the *whole* global Candidate
table (see CandidateMatcher.rank_candidates, which iterates
store.candidates.list_all()). So a per-job evaluation purge doesn't stick:
the next tab view regenerates it from the same global pool.

This deletes every Candidate, plus every Evaluation/Evidence/
AtsBenchmarkScore referencing them (across all jobs, since the pool is
shared) and any interview/handoff/screening/readiness records tied to
those candidate ids, so nothing dangling is left behind. Real candidates
uploaded afterward are untouched — this only removes what already existed
at run time.

Usage:
    python3 scripts/purge_dummy_candidates.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.storage.store import store  # noqa: E402


def main() -> None:
    candidates = store.candidates.list_all()
    candidate_ids = {str(c.id) for c in candidates}
    print(f"Found {len(candidates)} candidates to remove")

    evaluations = store.evaluations.list_all()
    print(f"Found {len(evaluations)} evaluations across all jobs to remove")
    for evaluation in evaluations:
        store.evidence.delete_for_evaluation(str(evaluation.id))
        store.ats_benchmarks.delete(str(evaluation.id))
        store.evaluations.delete(str(evaluation.id))

    handoffs = store.handoffs.query(lambda h: h.candidate_id in candidate_ids)
    print(f"Found {len(handoffs)} interview handoffs to remove")
    for h in handoffs:
        store.handoffs.delete(h.id)

    interviews = store.interviews.query(lambda i: str(i.candidate_id) in candidate_ids)
    print(f"Found {len(interviews)} scheduled interviews to remove")
    for i in interviews:
        store.interviews.delete(i.id)

    screenings = store.screening_sessions.query(lambda s: str(s.candidate_id) in candidate_ids)
    print(f"Found {len(screenings)} screening sessions to remove")
    for s in screenings:
        store.screening_sessions.delete(s.id)

    readiness = store.readiness_assessments.query(lambda r: str(r.candidate_id) in candidate_ids)
    print(f"Found {len(readiness)} readiness assessments to remove")
    for r in readiness:
        store.readiness_assessments.delete(r.id)

    for c in candidates:
        store.candidates.delete(c.id)

    remaining = store.candidates.list_all()
    remaining_evals = store.evaluations.list_all()
    print(f"Done. Remaining candidates: {len(remaining)}, remaining evaluations: {len(remaining_evals)}")


if __name__ == "__main__":
    main()
