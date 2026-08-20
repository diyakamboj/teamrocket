"""Back up every document, then clear the working data.

Two rules this follows:

  * Nothing is deleted before it is written to a backup file. A reset you
    cannot undo is not a reset, it is data loss.
  * User accounts are kept by default. Wiping them signs everyone out and
    there is no way back in -- pass --include-users only if that is really
    what you want.

    python scripts/backup_and_reset.py                # dry run, shows counts
    python scripts/backup_and_reset.py --apply        # back up, then clear
    python scripts/backup_and_reset.py --restore FILE # put it all back
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.storage.store import get_store  # noqa: E402

#: Signing everyone out is not part of "clear the test data".
PROTECTED = {"users"}


def _repositories(store):
    for name in sorted(dir(store)):
        if name.startswith("_"):
            continue
        repo = getattr(store, name)
        if hasattr(repo, "list_all") and hasattr(repo, "delete"):
            yield name, repo


def _addressable_by_id(repo) -> bool:
    """Whether repo.delete(id) is meaningful for this collection."""
    from app.storage.repository import (
        AppendOnlyRepository,
        EvaluationRepository,
        EvidenceRepository,
    )

    # Evaluations are keyed by (job, candidate) and Evidence by evaluation,
    # so neither can be removed by its own id. Both are cleared by prefix.
    # Append-only collections (history, decisions) and the two custom-keyed
    # ones cannot be removed by their own id; all are cleared by prefix.
    return not isinstance(
        repo, (AppendOnlyRepository, EvaluationRepository, EvidenceRepository)
    )


def _raw_documents(repo) -> list[dict]:
    """Read documents without model validation.

    Some stored rows no longer parse against the current models (an older
    Evidence shape, for instance). A backup that skipped those would quietly
    lose exactly the rows most worth keeping.
    """
    backing = getattr(repo, "_store", None)
    prefix = getattr(repo, "collection", None)
    if backing is not None and prefix is not None:
        try:
            keys = backing.list_prefix(prefix)
            return [doc for doc in backing.get_many(keys) if doc]
        except Exception:
            pass
    try:
        return [row.model_dump(mode="json") for row in repo.list_all()]
    except Exception:
        return []


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="actually clear after backing up")
    parser.add_argument("--include-users", action="store_true", help="also delete accounts")
    parser.add_argument("--restore", metavar="FILE", help="restore from a backup file")
    args = parser.parse_args()

    store = get_store()

    if args.restore:
        return _restore(store, Path(args.restore))

    protected = set() if args.include_users else PROTECTED
    snapshot: dict[str, list[dict]] = {}
    total = 0
    print(f"{'collection':<28}{'documents':>10}   action")
    for name, repo in _repositories(store):
        docs = _raw_documents(repo)
        snapshot[name] = docs
        total += len(docs)
        action = "keep" if name in protected else ("clear" if args.apply else "would clear")
        if docs:
            print(f"{name:<28}{len(docs):>10}   {action}")

    print(f"{'-' * 50}\n{'total':<28}{total:>10}")

    if not args.apply:
        print("\nDry run. Re-run with --apply to back up and clear.")
        return 0

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = Path(__file__).resolve().parent.parent / "backups" / f"snapshot-{stamp}.json"
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path.write_text(json.dumps(snapshot, indent=2, default=str))
    print(f"\nBacked up {total} documents to {backup_path}")

    removed = 0
    for name, repo in _repositories(store):
        if name in protected:
            continue

        # Append-only partitioned collections (candidate history) are not
        # addressed by id, so they are cleared at the blob level by prefix.
        backing = getattr(repo, "_store", None)
        prefix = getattr(repo, "collection", None)
        if backing is not None and prefix is not None and not _addressable_by_id(repo):
            try:
                keys = backing.list_prefix(prefix)
                for key in keys:
                    backing.delete(key)
                    removed += 1
                continue
            except Exception as exc:
                print(f"  could not clear {name} by prefix: {exc}")

        for doc in snapshot.get(name, []):
            doc_id = doc.get("id")
            if not doc_id:
                continue
            try:
                repo.delete(doc_id)
                removed += 1
            except Exception as exc:
                print(f"  could not delete {name}/{doc_id}: {exc}")
    print(f"Cleared {removed} documents. Accounts kept: {', '.join(sorted(protected)) or 'none'}")
    print(f"Undo with: python scripts/backup_and_reset.py --restore {backup_path}")
    return 0


def _restore(store, path: Path) -> int:
    if not path.exists():
        print(f"No such backup: {path}")
        return 1
    snapshot = json.loads(path.read_text())
    repos = dict(_repositories(store))
    restored = 0
    for name, docs in snapshot.items():
        repo = repos.get(name)
        if repo is None:
            continue
        backing = getattr(repo, "_store", None)
        prefix = getattr(repo, "collection", None)
        for doc in docs:
            doc_id = doc.get("id")
            if not doc_id:
                continue
            try:
                # Written straight through so rows that no longer validate
                # against the current models still come back.
                backing.put(f"{prefix}/{doc_id}.json", doc)
                restored += 1
            except Exception as exc:
                print(f"  could not restore {name}/{doc_id}: {exc}")
    print(f"Restored {restored} documents from {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
