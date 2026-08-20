"""Azure Cosmos DB (NoSQL API) as the candidate vector store.

Cosmos stores each candidate as a document with its embedding inline and
searches with `VectorDistance()`, so the vector lives beside the record
rather than in a separate index that has to be kept in step. Scoping is a
plain WHERE clause, evaluated server-side, so a recruiter's query never
pulls back another recruiter's rows.

Two things the container must have, and they can only be set at creation
time -- an existing container cannot be given a vector policy afterwards:

  vector_embedding_policy   path /contentVector, cosine, 1536 dimensions
  indexing_policy           a vectorIndexes entry for /contentVector

`ensure_ready()` creates the database and container with both when they are
absent, which is why it is safe to point this at an empty account.

The account also needs the "Vector Search for NoSQL API" capability enabled
(Azure portal -> the account -> Features). Without it Cosmos rejects the
container creation, and the error says so.

Scores: Cosmos returns cosine *similarity* in -1..1 from VectorDistance()
with a cosine policy, which is the same scale the other backends report, so
"% fit" in the UI means the same thing whichever one answered.
"""

from __future__ import annotations

import threading
from typing import Any, Optional

from app.config import settings
from app.utils.logger import get_logger

logger = get_logger(__name__)

VECTOR_SIZE = 1536
VECTOR_PATH = "/contentVector"


class CosmosVectorIndex:
    def __init__(self) -> None:
        self._container = None
        self._lock = threading.Lock()
        self._ready = False
        self._failed = False

    @property
    def configured(self) -> bool:
        return bool(settings.COSMOS_ENDPOINT and settings.COSMOS_KEY)

    def _connect(self):
        """Open the container, creating database and container if needed."""
        if self._ready:
            return self._container
        # One failed attempt is enough; retrying per-request would add the
        # connection timeout to every search on a misconfigured account.
        if self._failed or not self.configured:
            return None

        with self._lock:
            if self._ready:
                return self._container
            if self._failed:
                return None
            try:
                from azure.cosmos import CosmosClient, PartitionKey

                client = CosmosClient(settings.COSMOS_ENDPOINT, credential=settings.COSMOS_KEY)
                database = client.create_database_if_not_exists(id=settings.COSMOS_DATABASE)

                vector_embedding_policy = {
                    "vectorEmbeddings": [
                        {
                            "path": VECTOR_PATH,
                            "dataType": "float32",
                            "distanceFunction": "cosine",
                            "dimensions": VECTOR_SIZE,
                        }
                    ]
                }
                indexing_policy = {
                    "indexingMode": "consistent",
                    "includedPaths": [{"path": "/*"}],
                    # The vector path must be excluded from the normal index:
                    # a 1536-element array indexed as ordinary data is pure
                    # RU cost and is never used for the vector search.
                    "excludedPaths": [{"path": '/"_etag"/?'}, {"path": f"{VECTOR_PATH}/*"}],
                    "vectorIndexes": [{"path": VECTOR_PATH, "type": "diskANN"}],
                }

                container = database.create_container_if_not_exists(
                    id=settings.COSMOS_CONTAINER,
                    partition_key=PartitionKey(path="/owner_email"),
                    indexing_policy=indexing_policy,
                    vector_embedding_policy=vector_embedding_policy,
                )
                self._container = container
                self._ready = True
                logger.info(
                    "Cosmos vector container ready: %s/%s",
                    settings.COSMOS_DATABASE,
                    settings.COSMOS_CONTAINER,
                )
            except Exception as exc:
                self._failed = True
                logger.warning("Cosmos DB vector store unavailable: %s", exc)
                self._container = None
        return self._container

    @property
    def available(self) -> bool:
        return self._connect() is not None

    # ---------- writes ----------

    def upsert(self, record_id: str, vector: list[float], payload: dict[str, Any]) -> bool:
        container = self._connect()
        if container is None:
            return False
        try:
            container.upsert_item(self._document(record_id, vector, payload))
            return True
        except Exception as exc:
            logger.warning("Cosmos upsert failed for %s: %s", record_id, exc)
            return False

    def upsert_many(self, points: list[tuple[str, list[float], dict[str, Any]]]) -> int:
        container = self._connect()
        if container is None or not points:
            return 0
        written = 0
        for record_id, vector, payload in points:
            try:
                container.upsert_item(self._document(record_id, vector, payload))
                written += 1
            except Exception as exc:
                # One bad document must not abandon the rest of the backfill.
                logger.warning("Cosmos upsert failed for %s: %s", record_id, exc)
        return written

    @staticmethod
    def _document(record_id: str, vector: list[float], payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": str(record_id),
            "record_id": str(record_id),
            # Partition key. Empty string rather than None: Cosmos treats a
            # missing partition key differently from a present-but-empty one,
            # and a legacy candidate with no owner still has to be writable.
            "owner_email": str(payload.get("owner_email") or ""),
            "name": payload.get("name") or "",
            "title": payload.get("title") or "",
            "employment_status": payload.get("employment_status") or "",
            "source": payload.get("source") or "",
            "contentVector": vector,
        }

    def delete(self, record_id: str, owner_email: str = "") -> None:
        container = self._connect()
        if container is None:
            return
        try:
            container.delete_item(item=str(record_id), partition_key=str(owner_email or ""))
        except Exception as exc:
            logger.warning("Cosmos delete failed for %s: %s", record_id, exc)

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
        """Nearest neighbours, or None if Cosmos could not be reached.

        None is deliberately not an empty list: an empty list would tell a
        recruiter nobody matched when in fact the database was unreachable,
        and would skip the fallback to the local index.
        """
        container = self._connect()
        if container is None:
            return None

        # Parameterised: an owner_email carrying a quote would otherwise
        # break the query, and query text must never be built by hand.
        conditions = []
        parameters: list[dict[str, Any]] = [{"name": "@vector", "value": vector}]
        if owner_email:
            conditions.append("c.owner_email = @owner")
            parameters.append({"name": "@owner", "value": owner_email})
        if employment_status:
            conditions.append("c.employment_status = @status")
            parameters.append({"name": "@status", "value": employment_status})
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        query = (
            f"SELECT TOP {int(limit)} c.record_id, c.name, c.title, c.owner_email, "
            f"c.employment_status, c.source, "
            f"VectorDistance(c.{VECTOR_PATH.lstrip('/')}, @vector) AS score "
            f"FROM c {where} "
            f"ORDER BY VectorDistance(c.{VECTOR_PATH.lstrip('/')}, @vector)"
        )

        try:
            rows = list(
                container.query_items(
                    query=query,
                    parameters=parameters,
                    # Without a partition key Cosmos needs permission to fan
                    # out; an unscoped search legitimately spans partitions.
                    enable_cross_partition_query=True,
                )
            )
        except Exception as exc:
            logger.warning("Cosmos vector query failed: %s", exc)
            return None

        results: list[tuple[str, float, dict[str, Any]]] = []
        for row in rows:
            score = float(row.get("score") or 0.0)
            if score < min_score:
                continue
            results.append(
                (
                    str(row.get("record_id") or row.get("id")),
                    score,
                    {
                        "owner_email": row.get("owner_email") or "",
                        "name": row.get("name") or "",
                        "title": row.get("title") or "",
                        "employment_status": row.get("employment_status") or "",
                        "source": row.get("source") or "",
                    },
                )
            )
        return results

    def list_ids(self) -> Optional[set[str]]:
        container = self._connect()
        if container is None:
            return None
        try:
            rows = container.query_items(
                query="SELECT c.record_id FROM c", enable_cross_partition_query=True
            )
            return {str(r["record_id"]) for r in rows if r.get("record_id")}
        except Exception as exc:
            logger.warning("Cosmos id listing failed: %s", exc)
            return None

    def count(self) -> int:
        container = self._connect()
        if container is None:
            return 0
        try:
            rows = list(
                container.query_items(
                    query="SELECT VALUE COUNT(1) FROM c", enable_cross_partition_query=True
                )
            )
            return int(rows[0]) if rows else 0
        except Exception as exc:
            logger.warning("Cosmos count failed: %s", exc)
            return 0


candidate_cosmos = CosmosVectorIndex()
