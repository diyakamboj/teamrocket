"""Assign ownerless candidates and jobs to an account.

Candidates and jobs are scoped to the recruiter who created them. Records
made before ownership existed have no owner, so they belong to nobody and no
account can see them — including the dataset imported by
`import_synthetic_dataset.py`.

Point them at your account:

    python3 scripts/assign_legacy_owner.py --email you@example.com          # dry run
    python3 scripts/assign_legacy_owner.py --email you@example.com --apply

Only records with no owner are touched: another recruiter's data is never
reassigned.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.storage.store import store  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True, help="account to assign ownerless records to")
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    args = parser.parse_args()

    candidates = [c for c in store.candidates.list_all() if not c.owner_email]
    jobs = [j for j in store.jobs.list_all() if not j.created_by]

    verb = "assigning" if args.apply else "would assign"
    print(f"{verb} {len(candidates)} candidates and {len(jobs)} jobs to {args.email}")

    if not args.apply:
        print("\nDry run — nothing written. Re-run with --apply.")
        return

    for candidate in candidates:
        candidate.owner_email = args.email
    store.candidates.save_many(candidates)

    for job in jobs:
        job.created_by = args.email
    store.jobs.save_many(jobs)

    print("done — sign in as that account to see them.")


if __name__ == "__main__":
    main()
