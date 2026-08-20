"""Repository layer over `JsonBlobStore`: one keyed JSON document per entity.

Every entity used to be a SQLAlchemy table row; now it's a JSON blob at a
deterministic key. `Repository[T]` covers the common case (upsert-by-`id`,
list-all-by-collection-prefix, Python-side predicate filtering — the same
`.all()` + filter pattern the app already used against SQLAlchemy). A few
entities have non-default key schemes (see the plan's blob-key table) and
get their own subclass below.
"""

from __future__ import annotations

from typing import Callable, Generic, Optional, TypeVar

from pydantic import BaseModel

from app.models.ats_benchmark import AtsBenchmarkScore
from app.models.evaluation import Evaluation, Evidence
from app.models.handoff import CandidateHistoryEvent
from app.services.azure_services import JsonBlobStore
from app.storage.ids import new_sortable_id

T = TypeVar("T", bound=BaseModel)


class Repository(Generic[T]):
    """Generic id-keyed repository: blob key is `{collection}/{id}.json`."""

    #: True for collections whose documents are written once and never
    #: modified. Listing those can skip ETags, and cached copies never need
    #: revalidating — see `JsonBlobStore.list_prefix`.
    IMMUTABLE_DOCUMENTS = False

    def __init__(self, store: JsonBlobStore, model: type[T], collection: str) -> None:
        self._store = store
        self._model = model
        self.collection = collection

    def _key(self, id_) -> str:
        return f"{self.collection}/{id_}.json"

    def get(self, id_) -> Optional[T]:
        doc = self._store.get(self._key(id_))
        if doc is None:
            return None
        return self._model.model_validate(doc)

    def _key_for(self, obj: T) -> str:
        """Blob key an entity is stored under. Subclasses with their own key
        scheme override this so batched writes land where `save` puts them."""
        return self._key(obj.id)

    def save(self, obj: T) -> T:
        self._store.put(self._key(obj.id), obj.model_dump(mode="json"))
        return obj

    def save_many(self, objs: list[T]) -> list[T]:
        """Write many entities in one concurrent batch. Saving in a loop costs
        a round-trip each, which is what made bulk re-scoring slow."""
        self._store.put_many(
            [(self._key_for(obj), obj.model_dump(mode="json")) for obj in objs],
            strict=True,
        )
        return objs

    def delete(self, id_) -> None:
        self._store.delete(self._key(id_))

    def list_all(self) -> list[T]:
        keys = self._store.list_prefix(
            self.collection, immutable=self.IMMUTABLE_DOCUMENTS
        )
        return [
            self._model.model_validate(doc)
            for doc in self._store.get_many(keys)
            if doc is not None
        ]

    def query(self, predicate: Callable[[T], bool]) -> list[T]:
        return [obj for obj in self.list_all() if predicate(obj)]


class AppendOnlyRepository(Repository[T]):
    """Flat, write-mostly collection keyed by a generated sortable id rather
    than the entity's own `id` field — AuditLog, CandidateDecision,
    CandidateHistoryEvent. Chronological by key; never addressed by id
    (the app only ever lists + filters these, same as today's SQL queries).
    """

    IMMUTABLE_DOCUMENTS = True

    def save(self, obj: T) -> T:
        key = f"{self.collection}/{new_sortable_id()}.json"
        self._store.put(key, obj.model_dump(mode="json"))
        return obj

    def save_many(self, objs: list[T]) -> list[T]:
        self._store.put_many(
            [
                (f"{self.collection}/{new_sortable_id()}.json", obj.model_dump(mode="json"))
                for obj in objs
            ]
        )
        return objs

    def get(self, id_) -> Optional[T]:
        raise NotImplementedError(f"{self.collection} entities are not addressed by id")

    def delete(self, id_) -> None:
        raise NotImplementedError(f"{self.collection} entities are not addressed by id")


class PartitionedAppendOnlyRepository(AppendOnlyRepository[T]):
    """Append-only collection sharded by an owning entity id.

    Key: `{collection}/{partition}/{sortable_id}.json`. Reads for one owner
    list just that partition instead of pulling the whole collection back and
    filtering in Python — candidate history had grown past 4,000 events, so
    fetching one candidate's handful read every one of them.

    Documents written under the old flat scheme are still found (see
    `_legacy_scan`) until `scripts/compact_blob_documents.py` moves them.
    """

    #: Written by the migration to record that no flat documents remain,
    #: which lets reads skip the legacy scan entirely.
    _MIGRATED_MARKER = "_partitioned.json"

    def _partition_of(self, obj: T) -> str:
        raise NotImplementedError

    def _key_for(self, obj: T) -> str:
        return f"{self.collection}/{self._partition_of(obj)}/{new_sortable_id()}.json"

    def save(self, obj: T) -> T:
        self._store.put(self._key_for(obj), obj.model_dump(mode="json"))
        return obj

    def save_many(self, objs: list[T]) -> list[T]:
        self._store.put_many(
            [(self._key_for(obj), obj.model_dump(mode="json")) for obj in objs]
        )
        return objs

    def _marker_key(self) -> str:
        return f"{self.collection}/{self._MIGRATED_MARKER}"

    def mark_partitioned(self) -> None:
        self._store.put(self._marker_key(), {"partitioned": True})

    def _legacy_scan(self, partition: str) -> list[T]:
        """Flat-layout fallback: whole-collection read, filtered in Python.

        Skipped once the migration marker says nothing is flat — that marker
        is what makes the fast path fast.
        """
        if self._store.get(self._marker_key()) is not None:
            return []
        return [obj for obj in self.list_all() if self._partition_of(obj) == partition]

    def list_for_partition(self, partition: str) -> list[T]:
        """Every document for one owner, from both layouts.

        The layouts are merged rather than preferred: a partition that already
        holds documents says nothing about whether older ones are still flat,
        and dropping those would silently lose history.
        """
        keys = self._store.list_prefix(f"{self.collection}/{partition}", immutable=True)
        rows = [
            self._model.model_validate(doc)
            for doc in self._store.get_many(keys)
            if doc is not None
        ]
        seen = {getattr(row, "id", None) for row in rows}
        rows.extend(
            legacy
            for legacy in self._legacy_scan(partition)
            if getattr(legacy, "id", None) not in seen
        )
        return rows

    def list_all(self) -> list[T]:
        marker = self._marker_key()
        keys = [
            key
            for key in self._store.list_prefix(self.collection, immutable=True)
            if key != marker
        ]
        return [
            self._model.model_validate(doc)
            for doc in self._store.get_many(keys)
            if doc is not None
        ]


class CandidateHistoryRepository(PartitionedAppendOnlyRepository[CandidateHistoryEvent]):
    """Key: `candidate_history_events/{candidate_id}/{sortable_id}.json`."""

    def __init__(self, store: JsonBlobStore) -> None:
        super().__init__(store, CandidateHistoryEvent, "candidate_history_events")

    def _partition_of(self, obj: CandidateHistoryEvent) -> str:
        return str(obj.candidate_id)

    def list_for_candidate(self, candidate_id) -> list[CandidateHistoryEvent]:
        return self.list_for_partition(str(candidate_id))


class EvaluationRepository(Repository[Evaluation]):
    """Key: `evaluations/{job_id}/{candidate_id}.json` — encodes the
    (candidate_id, job_id) unique constraint as the key itself; saving is
    upsert-by-overwrite. A secondary pointer blob at
    `evaluations/_by_id/{evaluation_id}.json` maps the evaluation's own id
    to {job_id, candidate_id} for the two routes that address an Evaluation
    by its own id rather than by (job, candidate).
    """

    _POINTER_PREFIX = "_by_id"

    def __init__(self, store: JsonBlobStore) -> None:
        super().__init__(store, Evaluation, "evaluations")

    def _entity_key(self, job_id, candidate_id) -> str:
        return f"{self.collection}/{job_id}/{candidate_id}.json"

    def _pointer_key(self, evaluation_id) -> str:
        return f"{self.collection}/{self._POINTER_PREFIX}/{evaluation_id}.json"

    def get_for(self, job_id, candidate_id) -> Optional[Evaluation]:
        doc = self._store.get(self._entity_key(job_id, candidate_id))
        if doc is None:
            return None
        return Evaluation.model_validate(doc)

    def _key_for(self, obj: Evaluation) -> str:
        return self._entity_key(obj.job_id, obj.candidate_id)

    def _pointer_doc(self, obj: Evaluation) -> dict:
        return {"job_id": str(obj.job_id), "candidate_id": str(obj.candidate_id)}

    def save(self, obj: Evaluation) -> Evaluation:
        # Entity and pointer go out together rather than back to back.
        self._store.put_many(
            [
                (self._key_for(obj), obj.model_dump(mode="json")),
                (self._pointer_key(obj.id), self._pointer_doc(obj)),
            ],
            strict=True,
        )
        return obj

    def save_many(self, objs: list[Evaluation]) -> list[Evaluation]:
        items: list[tuple[str, dict]] = []
        for obj in objs:
            items.append((self._key_for(obj), obj.model_dump(mode="json")))
            items.append((self._pointer_key(obj.id), self._pointer_doc(obj)))
        self._store.put_many(items, strict=True)
        return objs

    def get(self, id_) -> Optional[Evaluation]:
        pointer = self._store.get(self._pointer_key(id_))
        if pointer is None:
            return None
        return self.get_for(pointer["job_id"], pointer["candidate_id"])

    def delete(self, id_) -> None:
        pointer = self._store.get(self._pointer_key(id_))
        if pointer is None:
            return
        self._store.delete(self._entity_key(pointer["job_id"], pointer["candidate_id"]))
        self._store.delete(self._pointer_key(id_))

    def list_for_job(self, job_id) -> list[Evaluation]:
        keys = self._store.list_prefix(f"{self.collection}/{job_id}")
        return [
            Evaluation.model_validate(doc)
            for doc in self._store.get_many(keys)
            if doc is not None
        ]

    def list_all(self) -> list[Evaluation]:
        pointer_dir = f"{self.collection}/{self._POINTER_PREFIX}/"
        keys = [
            key
            for key in self._store.list_prefix(self.collection)
            if not key.startswith(pointer_dir)
        ]
        return [
            Evaluation.model_validate(doc)
            for doc in self._store.get_many(keys)
            if doc is not None
        ]


class EvidenceRepository(Repository[Evidence]):
    """Key: `evidence/{evaluation_id}.json` — every row for one evaluation in
    a single document, ordered as written (matching the old
    `order_by(created_at.asc())`).

    It used to be one blob per row, so re-scoring a candidate cost a LIST, a
    DELETE per existing row and a PUT per new row; re-ranking a pool spent
    most of its time here. One document per evaluation makes that one PUT.

    Rows written under the old per-row scheme are still read (see
    `_legacy_rows`), so this works before `scripts/compact_blob_documents.py`
    has been run; the consolidated document wins once it exists.
    """

    _ITEMS = "items"

    def __init__(self, store: JsonBlobStore) -> None:
        super().__init__(store, Evidence, "evidence")

    def _key(self, evaluation_id) -> str:
        return f"{self.collection}/{evaluation_id}.json"

    def _legacy_rows(self, evaluation_id) -> list[Evidence]:
        keys = [
            key
            for key in self._store.list_prefix(f"{self.collection}/{evaluation_id}")
            if key != self._key(evaluation_id)
        ]
        return [
            Evidence.model_validate(doc)
            for doc in self._store.get_many(keys)
            if doc is not None
        ]

    def _document(self, rows: list[Evidence]) -> dict:
        return {self._ITEMS: [row.model_dump(mode="json") for row in rows]}

    def get(self, id_) -> Optional[Evidence]:
        raise NotImplementedError("Evidence is not addressed by id, only by evaluation_id")

    def delete(self, id_) -> None:
        raise NotImplementedError("Evidence is not addressed by id, only by evaluation_id")

    def list_for_evaluation(self, evaluation_id) -> list[Evidence]:
        doc = self._store.get(self._key(evaluation_id))
        if doc is None:
            return self._legacy_rows(evaluation_id)
        return [Evidence.model_validate(item) for item in doc.get(self._ITEMS, [])]

    def save(self, obj: Evidence) -> Evidence:
        self.save_many([obj])
        return obj

    def save_many(self, objs: list[Evidence]) -> list[Evidence]:
        """Append rows, grouped so each evaluation costs one write."""
        if not objs:
            return objs
        by_evaluation: dict[str, list[Evidence]] = {}
        for obj in objs:
            by_evaluation.setdefault(str(obj.evaluation_id), []).append(obj)

        items = []
        for evaluation_id, rows in by_evaluation.items():
            existing = self.list_for_evaluation(evaluation_id)
            items.append((self._key(evaluation_id), self._document(existing + rows)))
        self._store.put_many(items)
        return objs

    def replace_for_evaluations(self, rows_by_evaluation: dict[str, list[Evidence]]) -> None:
        """Overwrite each evaluation's evidence in one batch of writes.

        Re-scoring knows the complete new set, so it neither reads the old
        rows nor deletes them first — the overwrite is the delete.
        """
        if not rows_by_evaluation:
            return
        self._store.put_many(
            [
                (self._key(evaluation_id), self._document(rows))
                for evaluation_id, rows in rows_by_evaluation.items()
            ]
        )

    def delete_for_evaluation(self, evaluation_id) -> None:
        self._store.delete(self._key(evaluation_id))
        legacy = [
            key
            for key in self._store.list_prefix(f"{self.collection}/{evaluation_id}")
            if key != self._key(evaluation_id)
        ]
        self._store.delete_many(legacy)


class AtsBenchmarkRepository(Repository[AtsBenchmarkScore]):
    """Key: `ats_benchmark_scores/{evaluation_id}.json` — encodes the
    `UniqueConstraint("evaluation_id")` as the key; upsert-by-overwrite.
    """

    def __init__(self, store: JsonBlobStore) -> None:
        super().__init__(store, AtsBenchmarkScore, "ats_benchmark_scores")

    def _key(self, evaluation_id) -> str:
        return f"{self.collection}/{evaluation_id}.json"

    def _key_for(self, obj: AtsBenchmarkScore) -> str:
        return self._key(obj.evaluation_id)

    def save(self, obj: AtsBenchmarkScore) -> AtsBenchmarkScore:
        self._store.put(self._key_for(obj), obj.model_dump(mode="json"))
        return obj

    def get_for_evaluation(self, evaluation_id) -> Optional[AtsBenchmarkScore]:
        return self.get(evaluation_id)
