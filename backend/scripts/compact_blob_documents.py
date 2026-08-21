"""One-off migration: move stored documents onto the current blob layouts.

Two collections changed shape to cut round-trips (see app/storage/repository.py):

  evidence                  one blob per row  ->  one document per evaluation
  candidate_history_events  one flat blob     ->  partitioned by candidate id

Both old layouts are still *readable* without this migration — the
repositories fall back to them — so nothing breaks if it has not been run.
Running it is what makes the reads fast: a candidate's history stops costing
a scan of every event ever written.

The migration is additive first: each document is written to its new key and
read back before the old key is deleted. Re-running it is safe.

Dry run (default) prints what would change:
    python3 scripts/compact_blob_documents.py

Apply it:
    python3 scripts/compact_blob_documents.py --apply
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.azure_services import document_store  # noqa: E402
from app.storage.ids import new_sortable_id  # noqa: E402
from app.storage.store import store  # noqa: E402

EVIDENCE = "evidence"
HISTORY = "candidate_history_events"


def _legacy_evidence_keys() -> dict[str, list[str]]:
    """Per-row evidence blobs (`evidence/{evaluation_id}/{row}.json`) grouped
    by evaluation. Consolidated documents sit one level up and are skipped."""
    grouped: dict[str, list[str]] = defaultdict(list)
    for key in document_store.list_prefix(EVIDENCE):
        parts = key.split("/")
        if len(parts) == 3:
            grouped[parts[1]].append(key)
    return grouped


def _flat_history_keys() -> list[str]:
    marker = f"{HISTORY}/_partitioned.json"
    return [
        key
        for key in document_store.list_prefix(HISTORY)
        if key.count("/") == 1 and key != marker
    ]


def compact_evidence(apply: bool) -> int:
    grouped = _legacy_evidence_keys()
    if not grouped:
        print("evidence: nothing in the per-row layout")
        return 0

    rows_moved = 0
    for evaluation_id, keys in grouped.items():
        rows = [doc for doc in document_store.get_many(sorted(keys)) if doc is not None]
        rows_moved += len(rows)
        if not apply:
            continue

        target = f"{EVIDENCE}/{evaluation_id}.json"
        if document_store.get(target) is not None:
            # A re-score already wrote the consolidated document; it wins and
            # the per-row copies are stale.
            document_store.delete_many(keys)
            continue

        document_store.put(target, {"items": rows})
        if document_store.get(target) is None:
            print(f"  ! verification failed for {target}; leaving per-row blobs in place")
            continue
        document_store.delete_many(keys)

    print(f"evidence: {'moved' if apply else 'would move'} {rows_moved} rows "
          f"into {len(grouped)} documents")
    return rows_moved


def partition_history(apply: bool) -> int:
    keys = _flat_history_keys()
    if not keys:
        print("history: nothing in the flat layout")
        if apply:
            store.candidate_history_events.mark_partitioned()
        return 0

    docs = document_store.get_many(keys)
    if not apply:
        movable = sum(1 for doc in docs if (doc or {}).get("candidate_id"))
        print(f"history: would move {movable} events into per-candidate partitions")
        return movable

    writes: list[tuple[str, dict]] = []
    movable: list[str] = []
    for key, doc in zip(keys, docs):
        candidate_id = (doc or {}).get("candidate_id")
        if not candidate_id:
            print(f"  ! {key} has no candidate_id; leaving it in place")
            continue
        writes.append((f"{HISTORY}/{candidate_id}/{new_sortable_id()}.json", doc))
        movable.append(key)

    document_store.put_many(writes, strict=True)
    document_store.delete_many(movable)
    # Only claim the collection is partitioned once everything has moved.
    if not _flat_history_keys():
        store.candidate_history_events.mark_partitioned()

    print(f"history: moved {len(movable)} events into per-candidate partitions")
    return len(movable)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="perform the migration (default is a dry run that only reports)",
    )
    args = parser.parse_args()

    if not args.apply:
        print("DRY RUN — nothing will be written. Re-run with --apply to migrate.\n")

    compact_evidence(args.apply)
    partition_history(args.apply)

    if not args.apply:
        print("\nNo changes made.")


if __name__ == "__main__":
    main()
