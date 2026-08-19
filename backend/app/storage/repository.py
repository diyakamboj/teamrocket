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
from app.services.azure_services import JsonBlobStore
from app.storage.ids import new_sortable_id

T = TypeVar("T", bound=BaseModel)


class Repository(Generic[T]):
    """Generic id-keyed repository: blob key is `{collection}/{id}.json`."""

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

    def save(self, obj: T) -> T:
        self._store.put(self._key(obj.id), obj.model_dump(mode="json"))
        return obj

    def delete(self, id_) -> None:
        self._store.delete(self._key(id_))

    def list_all(self) -> list[T]:
        keys = self._store.list_prefix(self.collection)
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

    def save(self, obj: T) -> T:
        key = f"{self.collection}/{new_sortable_id()}.json"
        self._store.put(key, obj.model_dump(mode="json"))
        return obj

    def get(self, id_) -> Optional[T]:
        raise NotImplementedError(f"{self.collection} entities are not addressed by id")

    def delete(self, id_) -> None:
        raise NotImplementedError(f"{self.collection} entities are not addressed by id")


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

    def save(self, obj: Evaluation) -> Evaluation:
        self._store.put(self._entity_key(obj.job_id, obj.candidate_id), obj.model_dump(mode="json"))
        self._store.put(
            self._pointer_key(obj.id),
            {"job_id": str(obj.job_id), "candidate_id": str(obj.candidate_id)},
        )
        return obj

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
            k for k in self._store.list_prefix(self.collection) if not k.startswith(pointer_dir)
        ]
        return [
            Evaluation.model_validate(doc)
            for doc in self._store.get_many(keys)
            if doc is not None
        ]


class EvidenceRepository(Repository[Evidence]):
    """Key: `evidence/{evaluation_id}/{sortable_id}.json` — chronological by
    key (matches `order_by(created_at.asc())`); `delete_for_evaluation()`
    replaces the FK cascade used when re-scoring.
    """

    def __init__(self, store: JsonBlobStore) -> None:
        super().__init__(store, Evidence, "evidence")

    def save(self, obj: Evidence) -> Evidence:
        key = f"{self.collection}/{obj.evaluation_id}/{new_sortable_id()}.json"
        self._store.put(key, obj.model_dump(mode="json"))
        return obj

    def get(self, id_) -> Optional[Evidence]:
        raise NotImplementedError("Evidence is not addressed by id, only by evaluation_id")

    def delete(self, id_) -> None:
        raise NotImplementedError("Evidence is not addressed by id, only by evaluation_id")

    def list_for_evaluation(self, evaluation_id) -> list[Evidence]:
        keys = self._store.list_prefix(f"{self.collection}/{evaluation_id}")
        return [
            Evidence.model_validate(doc)
            for doc in self._store.get_many(keys)
            if doc is not None
        ]

    def save_many(self, objs: list[Evidence]) -> list[Evidence]:
        """Re-scoring writes every evidence row for an evaluation at once;
        doing that one blob PUT at a time dominated the ranking endpoint."""
        self._store.put_many(
            [
                (
                    f"{self.collection}/{obj.evaluation_id}/{new_sortable_id()}.json",
                    obj.model_dump(mode="json"),
                )
                for obj in objs
            ]
        )
        return objs

    def delete_for_evaluation(self, evaluation_id) -> None:
        keys = self._store.list_prefix(f"{self.collection}/{evaluation_id}")
        self._store.delete_many(keys)


class AtsBenchmarkRepository(Repository[AtsBenchmarkScore]):
    """Key: `ats_benchmark_scores/{evaluation_id}.json` — encodes the
    `UniqueConstraint("evaluation_id")` as the key; upsert-by-overwrite.
    """

    def __init__(self, store: JsonBlobStore) -> None:
        super().__init__(store, AtsBenchmarkScore, "ats_benchmark_scores")

    def _key(self, evaluation_id) -> str:
        return f"{self.collection}/{evaluation_id}.json"

    def save(self, obj: AtsBenchmarkScore) -> AtsBenchmarkScore:
        self._store.put(self._key(obj.evaluation_id), obj.model_dump(mode="json"))
        return obj

    def get_for_evaluation(self, evaluation_id) -> Optional[AtsBenchmarkScore]:
        return self.get(evaluation_id)
