"""Remove synthetic test accounts and everything they own.

Test accounts registered during development show up in the recruiter
directory, where they read as dummy data to anyone who did not create them.
Their candidates and jobs go too — deleting the account alone would leave
records owned by nobody.

Real accounts are identified by exclusion: anything on a throwaway domain is
synthetic. Nothing is deleted before a snapshot is written.

    python scripts/remove_test_accounts.py           # report only
    python scripts/remove_test_accounts.py --apply
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.storage.store import get_store  # noqa: E402

#: Domains only ever used by generated accounts.
SYNTHETIC = re.compile(r"@resumeiq\.test$|@example\.com$|@example\.org$")

#: Fields that name an owner, across the different models.
OWNER_FIELDS = ("owner_email", "created_by", "recruiter_email", "recruiter_a", "recruiter_b")


def owner_of(row) -> str | None:
    """Who this record belongs to.

    A User names itself with `email`; every other model names its owner with
    one of OWNER_FIELDS. The distinction matters: a Candidate also has an
    `email`, and matching on that would both miss test candidates (whose own
    address is not synthetic) and delete a *real* recruiter's candidate who
    happens to have an example.com address.
    """
    from app.models.user import User

    if isinstance(row, User):
        return str(row.email).lower()

    for field in OWNER_FIELDS:
        value = getattr(row, field, None)
        if value:
            return str(value).lower()
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    store = get_store()
    doomed = {u.email.lower() for u in store.users.list_all() if SYNTHETIC.search(u.email)}
    if not doomed:
        print("No synthetic accounts found.")
        return 0

    print(f"{len(doomed)} test account(s):")
    for email in sorted(doomed):
        print(f"  - {email}")

    snapshot: dict[str, list] = {}
    plan: list[tuple[str, object, str]] = []

    for name in sorted(dir(store)):
        if name.startswith("_"):
            continue
        repo = getattr(store, name)
        if not (hasattr(repo, "list_all") and hasattr(repo, "delete")):
            continue
        try:
            rows = repo.list_all()
        except Exception:
            continue
        hits = [r for r in rows if owner_of(r) in doomed]
        if not hits:
            continue
        snapshot[name] = [r.model_dump(mode="json") for r in hits]
        plan.append((name, repo, ""))
        print(f"  {name:<24} {len(hits)} row(s)")

    if not args.apply:
        print("\nReport only. Re-run with --apply to remove.")
        return 0

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup = Path(__file__).resolve().parent.parent / "backups" / f"test-accounts-{stamp}.json"
    backup.parent.mkdir(parents=True, exist_ok=True)
    backup.write_text(json.dumps(snapshot, indent=2, default=str))
    print(f"\nBacked up to {backup}")

    removed = 0
    for name, repo, _ in plan:
        for doc in snapshot[name]:
            doc_id = doc.get("id")
            if not doc_id:
                continue
            try:
                repo.delete(doc_id)
                removed += 1
            except Exception as exc:
                print(f"  could not delete {name}/{doc_id}: {exc}")

    print(f"Removed {removed} record(s) across {len(plan)} collection(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
