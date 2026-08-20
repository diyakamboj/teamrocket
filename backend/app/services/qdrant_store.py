"""Qdrant backend for candidate vectors.

Qdrant is a purpose-built vector database: HNSW indexing, cosine distance,
and payload filters applied *during* the search rather than after it, so
scoping a query to one recruiter never costs us other recruiters' rows.

It runs in two shapes and the code is identical for both:

  embedded  QDRANT_PATH -- vectors live in a local directory, no server to
            run or pay for. Single-process: the directory is locked by
            whoever opens it, so it suits one API process, not a fleet.
  server    QDRANT_URL -- a real Qdrant instance, shared by as many
            processes as you like.

Scores are cosine similarity in the same -1..1 range the other backends
report, so a `min_score` cutoff and the "% fit" the UI renders mean the same
thing whichever backend answered.
"""

from __future__ import annotations

import atexit
import threading
from typing import Any, Optional

from app.config import settings
from app.utils.logger import get_logger

logger = get_logger(__name__)

# text-embedding-3-small
VECTOR_SIZE = 1536


class QdrantVectorIndex:
    """Thin wrapper over one Qdrant collection."""

    def __init__(self) -> None:
        self._client = None
        self._lock = threading.Lock()
        self._ready = False

    @property
    def collection(self) -> str:
        return settings.QDRANT_COLLECTION

    def _connect(self):
        """Open the client and make sure the collection exists.

        Guarded by a lock because the embedded backend takes an exclusive
        lock on its storage directory -- two threads racing to open it would
        have one of them fail rather than share.
        """
        if self._ready:
            return self._client
        with self._lock:
            if self._ready:
                return self._client
            try:
                from qdrant_client import QdrantClient
                from qdrant_client.models import Distance, VectorParams

                if settings.QDRANT_URL:
                    client = QdrantClient(
                        url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY
                    )
                else:
                    client = QdrantClient(path=settings.QDRANT_PATH)

                existing = {c.name for c in client.get_collections().collections}
                if self.collection not in existing:
                    client.create_collection(
                        collection_name=self.collection,
                        vectors_config=VectorParams(
                            size=VECTOR_SIZE, distance=Distance.COSINE
                        ),
                    )
                    logger.info("Created Qdrant collection %s", self.collection)

                self._client = client
                self._ready = True
                # Embedded Qdrant holds a lock on its storage directory and
                # closes itself in __del__. During interpreter shutdown that
                # runs too late to import what it needs and raises noise on
                # the way out, so close it deliberately first.
                atexit.register(self.close)
            except Exception as exc:
                logger.warning("Qdrant unavailable: %s", exc)
                self._client = None
        return self._client

    @property
    def available(self) -> bool:
        return self._connect() is not None

    # ---------- writes ----------

    def upsert(self, record_id: str, vector: list[float], payload: dict[str, Any]) -> bool:
        client = self._connect()
        if client is None:
            return False
        try:
            from qdrant_client.models import PointStruct

            client.upsert(
                collection_name=self.collection,
                points=[
                    PointStruct(id=_point_id(record_id), vector=vector, payload=payload)
                ],
            )
            return True
        except Exception as exc:
            logger.warning("Qdrant upsert failed for %s: %s", record_id, exc)
            return False

    def upsert_many(self, points: list[tuple[str, list[float], dict[str, Any]]]) -> int:
        client = self._connect()
        if client is None or not points:
            return 0
        try:
            from qdrant_client.models import PointStruct

            batch = [
                PointStruct(id=_point_id(rid), vector=vec, payload=payload)
                for rid, vec, payload in points
            ]
            client.upsert(collection_name=self.collection, points=batch)
            return len(batch)
        except Exception as exc:
            logger.warning("Qdrant bulk upsert failed: %s", exc)
            return 0

    def delete(self, record_id: str) -> None:
        client = self._connect()
        if client is None:
            return
        try:
            client.delete(
                collection_name=self.collection, points_selector=[_point_id(record_id)]
            )
        except Exception as exc:
            logger.warning("Qdrant delete failed for %s: %s", record_id, exc)

    # ---------- reads ----------

    def search(
        self,
        vector: list[float],
        *,
        limit: int,
        owner_email: Optional[str] = None,
        employment_status: Optional[str] = None,
        min_score: float = 0.0,
    ) -> Optional[list[tuple[str, float, dict[str, Any]]]]:
        """Nearest neighbours, or None if Qdrant could not be reached.

        None is not an empty result: the caller falls back to the local index
        rather than telling a recruiter they have no matching candidates
        because a database was down.
        """
        client = self._connect()
        if client is None:
            return None
        try:
            from qdrant_client.models import FieldCondition, Filter, MatchValue

            conditions = []
            if owner_email:
                conditions.append(
                    FieldCondition(key="owner_email", match=MatchValue(value=owner_email))
                )
            if employment_status:
                conditions.append(
                    FieldCondition(
                        key="employment_status", match=MatchValue(value=employment_status)
                    )
                )

            hits = client.query_points(
                collection_name=self.collection,
                query=vector,
                query_filter=Filter(must=conditions) if conditions else None,
                limit=limit,
                score_threshold=min_score if min_score > 0 else None,
                with_payload=True,
            ).points

            return [
                (str((h.payload or {}).get("record_id") or h.id), float(h.score), h.payload or {})
                for h in hits
            ]
        except Exception as exc:
            logger.warning("Qdrant query failed: %s", exc)
            return None

    def close(self) -> None:
        client, self._client, self._ready = self._client, None, False
        if client is not None:
            try:
                client.close()
            except Exception:
                pass

    def count(self) -> int:
        client = self._connect()
        if client is None:
            return 0
        try:
            return int(client.count(collection_name=self.collection, exact=True).count)
        except Exception as exc:
            logger.warning("Qdrant count failed: %s", exc)
            return 0

    def list_ids(self) -> Optional[set[str]]:
        """Every record_id currently stored, or None if unreachable."""
        client = self._connect()
        if client is None:
            return None
        try:
            found: set[str] = set()
            offset = None
            while True:
                points, offset = client.scroll(
                    collection_name=self.collection,
                    limit=256,
                    offset=offset,
                    with_payload=True,
                    with_vectors=False,
                )
                for point in points:
                    record_id = (point.payload or {}).get("record_id")
                    if record_id:
                        found.add(str(record_id))
                if offset is None:
                    break
            return found
        except Exception as exc:
            logger.warning("Qdrant scroll failed: %s", exc)
            return None


def _point_id(record_id: str) -> str:
    """Qdrant point ids must be a UUID or an unsigned integer.

    Candidate ids are already UUIDs; anything else is hashed into the UUID
    space so an unexpected id shape cannot make the write fail. The original
    is kept in the payload as `record_id`, which is what we read back.
    """
    import uuid

    try:
        return str(uuid.UUID(str(record_id)))
    except (ValueError, AttributeError, TypeError):
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"resumeiq:{record_id}"))


candidate_qdrant = QdrantVectorIndex()
