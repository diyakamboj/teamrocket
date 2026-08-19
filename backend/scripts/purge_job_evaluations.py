"""One-off cleanup: remove every candidate evaluation from one job's pipeline.

Candidates in this app are shared across jobs (one Candidate can have an
Evaluation against several JobPostings), so this deliberately deletes only
the Evaluation + Evidence + AtsBenchmarkScore rows for the given job_id — it
never touches the Candidate documents themselves, which other jobs' pipelines
still reference.

Usage:
    python3 scripts/purge_job_evaluations.py <job_id>
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.storage.store import store  # noqa: E402


def main(job_id: str) -> None:
    job = store.jobs.get(job_id)
    if job is None:
        print(f"No job found with id {job_id}")
        return

    evaluations = store.evaluations.list_for_job(job_id)
    print(f"Job: {job.title!r} ({job_id}) — {len(evaluations)} evaluations to remove")

    for evaluation in evaluations:
        store.evidence.delete_for_evaluation(str(evaluation.id))
        store.ats_benchmarks.delete(str(evaluation.id))
        store.evaluations.delete(str(evaluation.id))

    remaining = store.evaluations.list_for_job(job_id)
    print(f"Done. Remaining evaluations for this job: {len(remaining)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 scripts/purge_job_evaluations.py <job_id>")
        sys.exit(1)
    main(sys.argv[1])
