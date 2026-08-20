"""Vector index for semantic candidate retrieval.

Embeddings were previously computed per request and thrown away, which makes
"find me candidates like this role" impossible without re-embedding the whole
pool every time. This persists them and answers nearest-neighbour queries.

Two backends behind one interface:

  blob   (default) vectors stored as JSON documents alongside everything else,
         searched by exact cosine similarity. No extra service to run, and
         exact rather than approximate — at a few thousand candidates the
         whole index is one batched read and the maths is milliseconds.
  search Azure AI Search with a vector field, for when the pool outgrows a
         brute-force scan. Selected by configuring AZURE_SEARCH_* and setting
         VECTOR_BACKEND=search.

Both store the same records, so switching backends is a re-index, not a
rewrite of the callers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Optional

from app.config import settings
from app.services.azure_services import document_store, openai_service, search_service
from app.services.qdrant_store import candidate_qdrant
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: Where vectors live in the document store.
VECTOR_PREFIX = "vector_index"


@dataclass
class VectorMatch:
    """One search hit.

    `score` is cosine similarity (-1..1) for a pure vector query. A hybrid
    query fuses vector and lexical rankings and scores them on an unrelated
    internal scale, so there is no comparable similarity to report and the
    score is None -- callers must render the absence rather than invent a
    percentage for it.
    """

    id: str
    score: Optional[float]
    metadata: dict[str, Any]


#: Standard RRF constant. Damps the influence of the very top ranks so one
#: engine's confident first hit cannot dominate the fused order.
RRF_K = 60


def reciprocal_rank_fusion(rankings: list[list[str]], *, k: int = RRF_K) -> list[str]:
    """Merge several ranked id lists into one, best first.

    Reciprocal rank fusion scores each id as the sum of 1/(k + rank) across
    the lists it appears in. It combines rankings without needing their
    scores to be comparable, which is the whole problem here: Qdrant returns
    cosine similarity and Azure returns BM25 relevance, and those numbers
    mean nothing to each other. Appearing in both lists is what lifts an id
    to the top.
    """
    scores: dict[str, float] = {}
    for ranking in rankings:
        for position, record_id in enumerate(ranking):
            if not record_id:
                continue
            scores[record_id] = scores.get(record_id, 0.0) + 1.0 / (k + position + 1)
    return sorted(scores, key=lambda rid: scores[rid], reverse=True)


def _search_filter(
    owner_email: Optional[str], employment_status: Optional[str]
) -> Optional[str]:
    """OData filter for Azure AI Search, scoping a query to one recruiter."""
    clauses = []
    if owner_email:
        clauses.append(f"owner_email eq '{owner_email}'")
    if employment_status:
        clauses.append(f"employment_status eq '{employment_status}'")
    return " and ".join(clauses) if clauses else None


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _cosine_from_search_score(score: float) -> float:
    """Undo Azure's cosine scoring transform, returning raw cosine similarity.

    For a cosine vector profile Azure reports `1 / (1 + distance)`, i.e.
    `1 / (2 - cosine)`. That is monotonic, so ranking is the same either way,
    but the *scale* is not: cosine 0 arrives as 0.5 and the floor is 0.333.
    The local fallback returns raw cosine, and the number reaches the UI as a
    "% fit", so leaving it untransformed meant an unrelated candidate reading
    60% from Azure and 34% from the fallback, and a `min_score` cutoff meaning
    two different things depending on which backend answered.
    """
    if score <= 0:
        return 0.0
    return 2.0 - 1.0 / score


class VectorStore:
    """Persistent vector index over one logical collection."""

    def __init__(self, collection: str = "candidates") -> None:
        self.collection = collection

    # ---------- embedding ----------

    @property
    def available(self) -> bool:
        """False when no embedding deployment is configured — callers fall
        back to keyword matching rather than failing."""
        return not openai_service.embeddings_mock

    def embed(self, text: str) -> Optional[list[float]]:
        vectors = openai_service.embed_texts([text])
        return vectors[0] if vectors else None

    # ---------- storage ----------

    def _key(self, record_id: str) -> str:
        return f"{VECTOR_PREFIX}/{self.collection}/{record_id}.json"

    def _use_azure_search(self) -> bool:
        return settings.VECTOR_BACKEND in ("search", "dual") and not search_service.mock

    def _use_qdrant(self) -> bool:
        return settings.VECTOR_BACKEND in ("qdrant", "dual")

    def _use_dual(self) -> bool:
        """Qdrant for vectors, Azure AI Search for keywords, results fused."""
        return settings.VECTOR_BACKEND == "dual"

    def upsert(self, record_id: str, text: str, metadata: dict[str, Any]) -> bool:
        """Index one record. Returns False when embeddings are unavailable,
        so the caller knows the record is not searchable rather than assuming
        it is."""
        vector = self.embed(text)
        if vector is None:
            return False

        document = {
            "id": str(record_id),
            "collection": self.collection,
            "vector": vector,
            "text": text[:4000],
            "metadata": metadata,
        }
        document_store.put(self._key(record_id), document)

        if self._use_qdrant():
            candidate_qdrant.upsert(
                str(record_id), vector, {**metadata, "record_id": str(record_id)}
            )

        if self._use_azure_search():
            try:
                # Field names must match the index schema — unknown fields are
                # rejected for the whole document, not ignored.
                search_service.upsert_candidate(
                    {
                        "id": str(record_id),
                        "content": text[:8000],
                        "contentVector": vector,
                        "owner_email": str(metadata.get("owner_email") or ""),
                        "name": str(metadata.get("name") or ""),
                        "title": str(metadata.get("title") or ""),
                        "employment_status": str(metadata.get("employment_status") or ""),
                        "source": str(metadata.get("source") or ""),
                    }
                )
            except Exception as exc:
                # The durable copy is already written; a search-service blip
                # must not lose the record.
                logger.warning("Vector upsert to Azure Search failed for %s: %s", record_id, exc)
        return True

    def delete(self, record_id: str) -> None:
        document_store.delete(self._key(record_id))
        if self._use_qdrant():
            candidate_qdrant.delete(str(record_id))
        if self._use_azure_search():
            search_service.delete_candidate(str(record_id))

    def _all_records(self) -> list[dict[str, Any]]:
        keys = document_store.list_prefix(f"{VECTOR_PREFIX}/{self.collection}")
        return [doc for doc in document_store.get_many(keys) if doc]

    # ---------- retrieval ----------

    def search(
        self,
        query_text: str,
        *,
        limit: int = 10,
        min_score: float = 0.0,
        owner_email: Optional[str] = None,
        employment_status: Optional[str] = None,
        hybrid: bool = False,
        predicate=None,
    ) -> list[VectorMatch]:
        """Nearest neighbours to `query_text`, best first.

        With `hybrid=True` the query also matches literally, so a name or an
        exact tool ("Kubernetes") ranks the way someone typing into a search
        box expects. Pure vector similarity is unreliable for short literal
        queries, so hybrid is the right mode for a search box and plain vector
        is the right mode for "find me people like this".

        `owner_email` and `employment_status` are the scoping filters, given
        as values rather than a callable so they can be pushed into the search
        index rather than applied after the fact — a Python-side predicate
        would mean the service returning other recruiters' rows for us to
        discard, which is both slower and a leak waiting to happen.
        `predicate` remains for anything the index cannot express, and only
        applies to the local backend.
        """
        query_vector = self.embed(query_text)
        if query_vector is None:
            return []

        if self._use_dual():
            fused = self._search_dual(
                query_text,
                query_vector,
                limit=limit,
                min_score=min_score,
                owner_email=owner_email,
                employment_status=employment_status,
                hybrid=hybrid,
            )
            if fused is not None:
                return fused
            logger.info("Falling back to the local vector index for this query")

        elif self._use_qdrant():
            hits = candidate_qdrant.search(
                query_vector,
                limit=limit,
                owner_email=owner_email,
                employment_status=employment_status,
                min_score=min_score,
            )
            if hits is not None:
                return [
                    VectorMatch(id=rid, score=round(score, 4), metadata=payload)
                    for rid, score, payload in hits
                ]
            logger.info("Falling back to the local vector index for this query")

        elif self._use_azure_search():
            remote = self._search_azure(
                query_vector,
                limit=limit,
                min_score=min_score,
                owner_email=owner_email,
                employment_status=employment_status,
                search_text=query_text if hybrid else None,
            )
            if remote is not None:
                return remote
            # None means the service could not be reached — fall through to
            # the local index rather than reporting "no candidates".
            logger.info("Falling back to the local vector index for this query")

        # The local index has no lexical engine; approximate hybrid by keeping
        # records whose text contains the query terms, so a name search still
        # works when Azure is unreachable.
        terms = [t for t in query_text.lower().split() if t] if hybrid else []

        matches: list[VectorMatch] = []
        literal: list[VectorMatch] = []
        for record in self._all_records():
            metadata = record.get("metadata") or {}
            if owner_email is not None and metadata.get("owner_email") != owner_email:
                continue
            if employment_status is not None and metadata.get("employment_status") != employment_status:
                continue
            if predicate and not predicate(metadata):
                continue
            vector = record.get("vector")
            if not vector:
                continue
            score = cosine(query_vector, vector)
            if score >= min_score:
                matches.append(
                    VectorMatch(id=str(record.get("id")), score=round(score, 4), metadata=metadata)
                )
            if terms:
                haystack = f"{record.get('text') or ''} {metadata.get('name') or ''}".lower()
                if all(term in haystack for term in terms):
                    literal.append(
                        VectorMatch(id=str(record.get("id")), score=None, metadata=metadata)
                    )

        matches.sort(key=lambda m: m.score or 0.0, reverse=True)
        if not terms:
            return matches[:limit]

        # Literal hits first -- someone typing a name wants that person, not
        # whoever is nearest in embedding space.
        ordered = literal + [m for m in matches if m.id not in {l.id for l in literal}]
        return ordered[:limit]

    def _search_dual(
        self,
        query_text: str,
        query_vector: list[float],
        *,
        limit: int,
        min_score: float,
        owner_email: Optional[str] = None,
        employment_status: Optional[str] = None,
        hybrid: bool = False,
    ) -> Optional[list[VectorMatch]]:
        """Qdrant for meaning, Azure AI Search for exact words, fused.

        Only a `hybrid` query needs both. A plain semantic query ("people like
        this one") wants ranking by distance alone, and mixing keyword hits
        into it would both distort the order and destroy the cosine score the
        UI renders as a percentage -- so that case is served by Qdrant only.

        Returns None if neither engine answered, so the caller can fall back
        to the local index. If exactly one answered we use it: half a result
        set beats telling a recruiter their search matched nobody.
        """
        vector_hits = candidate_qdrant.search(
            query_vector,
            limit=limit * 2 if hybrid else limit,
            owner_email=owner_email,
            employment_status=employment_status,
            min_score=0.0 if hybrid else min_score,
        )

        if not hybrid:
            if vector_hits is None:
                return None
            return [
                VectorMatch(id=rid, score=round(score, 4), metadata=payload)
                for rid, score, payload in vector_hits
            ]

        lexical_hits = search_service.lexical_search(
            query_text,
            limit=limit * 2,
            filter_expression=_search_filter(owner_email, employment_status),
        )

        if vector_hits is None and lexical_hits is None:
            return None

        vector_ranking = [rid for rid, _, _ in (vector_hits or [])]
        lexical_ranking = [
            str(hit.get("id")) for hit in (lexical_hits or []) if hit.get("id")
        ]

        metadata: dict[str, dict[str, Any]] = {}
        for rid, _, payload in vector_hits or []:
            metadata[rid] = payload
        for hit in lexical_hits or []:
            rid = str(hit.get("id") or "")
            if rid and rid not in metadata:
                metadata[rid] = {
                    "owner_email": hit.get("owner_email") or "",
                    "name": hit.get("name") or "",
                    "title": hit.get("title") or "",
                    "employment_status": hit.get("employment_status") or "",
                    "source": hit.get("source") or "",
                }

        fused = reciprocal_rank_fusion([vector_ranking, lexical_ranking])
        # Fused scores are RRF, not cosine, and belong to no comparable scale
        # -- reporting one as a "% fit" would be inventing a number.
        return [
            VectorMatch(id=rid, score=None, metadata=metadata.get(rid, {}))
            for rid in fused[:limit]
        ]

    def _search_azure(
        self,
        query_vector: list[float],
        *,
        limit: int,
        min_score: float,
        owner_email: Optional[str] = None,
        employment_status: Optional[str] = None,
        search_text: Optional[str] = None,
    ) -> Optional[list[VectorMatch]]:
        """Nearest neighbours from Azure AI Search, or None if it could not
        be reached. Scoping is pushed into the index filter so the service
        does the work rather than returning other recruiters' rows to be
        discarded here."""
        filter_expression = _search_filter(owner_email, employment_status)

        hits = search_service.vector_search(
            query_vector,
            limit=limit,
            filter_expression=filter_expression,
            search_text=search_text,
        )
        if hits is None:
            return None

        # A fused (hybrid) result carries an RRF score, which is not a
        # similarity and does not share the cosine scale. Reporting None beats
        # reporting a number that means something else.
        fused = search_text is not None

        matches = []
        for hit in hits:
            if fused:
                score = None
            else:
                score = _cosine_from_search_score(float(hit.get("@search.score") or 0.0))
                if score < min_score:
                    continue
            matches.append(
                VectorMatch(
                    id=str(hit.get("id")),
                    score=None if score is None else round(score, 4),
                    metadata={
                        "owner_email": hit.get("owner_email") or "",
                        "name": hit.get("name") or "",
                        "title": hit.get("title") or "",
                        "employment_status": hit.get("employment_status") or "",
                        "source": hit.get("source") or "",
                    },
                )
            )
        return matches

    def _azure_document(self, record: dict[str, Any]) -> dict[str, Any]:
        """One local record shaped for the search index."""
        metadata = record.get("metadata") or {}
        return {
            "id": str(record.get("id")),
            "content": (record.get("text") or "")[:8000],
            "contentVector": record.get("vector"),
            "owner_email": str(metadata.get("owner_email") or ""),
            "name": str(metadata.get("name") or ""),
            "title": str(metadata.get("title") or ""),
            "employment_status": str(metadata.get("employment_status") or ""),
            "source": str(metadata.get("source") or ""),
        }

    def sync_backend(self) -> dict[str, int]:
        """Backfill whichever external backend is selected.

        Switching VECTOR_BACKEND does not retroactively push what was already
        embedded, so without this every candidate indexed before the switch
        is missing from search -- queries answer "no matches" for a pool that
        is not empty. Vectors are already stored locally, so this uploads
        rather than re-embedding: no model calls, no cost.
        """
        if self._use_dual():
            # Both engines have to be complete: a candidate missing from
            # Qdrant is invisible to the semantic half, one missing from
            # Azure is invisible to the keyword half, and either way the
            # fused result is quietly short.
            qdrant = self._sync_to_qdrant()
            azure = self.sync_to_search()
            return {
                "local": qdrant["local"],
                "missing": qdrant["missing"] + azure["missing"],
                "uploaded": qdrant["uploaded"] + azure["uploaded"],
            }
        if self._use_qdrant():
            return self._sync_to_qdrant()
        return self.sync_to_search()

    def _sync_to_qdrant(self) -> dict[str, int]:
        records = self._all_records()
        known = candidate_qdrant.list_ids()
        if known is None:
            logger.warning("Could not read the Qdrant collection; skipping sync")
            return {"local": len(records), "missing": 0, "uploaded": 0}

        missing = [r for r in records if str(r.get("id")) not in known and r.get("vector")]
        uploaded = candidate_qdrant.upsert_many(
            [
                (
                    str(r["id"]),
                    r["vector"],
                    {**(r.get("metadata") or {}), "record_id": str(r["id"])},
                )
                for r in missing
            ]
        )
        if missing:
            logger.info(
                "Qdrant sync: %d local, %d missing, %d uploaded",
                len(records), len(missing), uploaded,
            )
        return {"local": len(records), "missing": len(missing), "uploaded": uploaded}

    def sync_to_search(self) -> dict[str, int]:
        """Push anything the local index holds but the search index does not.

        Turning VECTOR_BACKEND on does not retroactively upload what was
        indexed while it was off, so every candidate embedded before the
        switch became invisible to search -- queries returned "no matches"
        for a pool that was actually full. Vectors are already stored
        locally, so this re-uploads rather than re-embedding: no model calls,
        no cost.
        """
        if not self._use_azure_search():
            return {"local": 0, "missing": 0, "uploaded": 0}

        records = self._all_records()
        remote_ids = search_service.list_document_ids()
        if remote_ids is None:
            logger.warning("Could not read the search index; skipping sync")
            return {"local": len(records), "missing": 0, "uploaded": 0}

        missing = [
            r for r in records if str(r.get("id")) not in remote_ids and r.get("vector")
        ]
        uploaded = search_service.upsert_candidates(
            [self._azure_document(r) for r in missing]
        )
        if missing:
            logger.info(
                "Vector index sync: %d local, %d missing from search, %d uploaded",
                len(records), len(missing), uploaded,
            )
        return {"local": len(records), "missing": len(missing), "uploaded": uploaded}

    def count(self, predicate=None) -> int:
        records = self._all_records()
        if predicate is None:
            return len(records)
        return sum(1 for r in records if predicate(r.get("metadata") or {}))


#: Candidate index used by resume ingestion and the search endpoint.
candidate_vectors = VectorStore("candidates")


def candidate_document(candidate) -> str:
    """The text a candidate is embedded from.

    Skills, title and experience carry the signal for "who is like this";
    contact details and formatting noise do not, and including them dilutes
    the vector.
    """
    parts: list[str] = [candidate.name or ""]
    if candidate.title:
        parts.append(str(candidate.title))
    skills = [str(s) for s in (candidate.skills or [])]
    if skills:
        parts.append("Skills: " + ", ".join(skills))
    for entry in (candidate.experience or [])[:5]:
        if isinstance(entry, dict):
            bits = [str(entry.get(k)) for k in ("title", "company", "description") if entry.get(k)]
            if bits:
                parts.append(" — ".join(bits))
        elif entry:
            parts.append(str(entry))
    for entry in (candidate.education or [])[:3]:
        if isinstance(entry, dict):
            bits = [str(entry.get(k)) for k in ("degree", "field", "school") if entry.get(k)]
            if bits:
                parts.append(" ".join(bits))
    return "\n".join(p for p in parts if p.strip())[:6000]


def index_candidate(candidate) -> bool:
    """Index (or re-index) one candidate for semantic search."""
    return candidate_vectors.upsert(
        str(candidate.id),
        candidate_document(candidate),
        {
            "candidate_id": str(candidate.id),
            "owner_email": candidate.owner_email or "",
            "name": candidate.name,
            "title": candidate.title or "",
            "employment_status": getattr(candidate, "employment_status", None) or "",
            "source": getattr(candidate, "source", None) or "",
        },
    )
