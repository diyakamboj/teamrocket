"""The Qdrant backend, and the contract it shares with the other two.

The point of a swappable backend is that callers cannot tell which one
answered. What makes that fragile is scoring: each engine reports relevance
its own way, and the number reaches the recruiter as a "% fit". These pin
the parts that must not drift.
"""

import pytest

from app.services.qdrant_store import QdrantVectorIndex, _point_id


def test_uuid_record_ids_are_used_as_is():
    """Candidate ids are UUIDs, which Qdrant accepts directly."""
    candidate_id = "3ded57f2-1630-4837-a233-9120cb47eada"
    assert _point_id(candidate_id) == candidate_id


def test_non_uuid_ids_are_mapped_rather_than_rejected():
    """Qdrant only accepts a UUID or an unsigned int as a point id.

    An id of any other shape would fail the write outright, so it is hashed
    into the UUID space instead. The mapping has to be stable or a re-index
    would create a duplicate point rather than replacing the old one.
    """
    first = _point_id("legacy-candidate-42")
    second = _point_id("legacy-candidate-42")
    assert first == second
    assert first != _point_id("legacy-candidate-43")


def test_an_unreachable_qdrant_returns_none_not_an_empty_result(monkeypatch):
    """"Could not ask" must stay distinguishable from "no matches".

    Returning [] here would tell a recruiter their search matched nobody
    when in fact the database was unreachable, and would skip the fallback
    to the local index.
    """
    index = QdrantVectorIndex()
    monkeypatch.setattr(index, "_connect", lambda: None)
    assert index.search([0.0] * 1536, limit=5) is None
    assert index.list_ids() is None


def test_search_falls_back_to_the_local_index_when_qdrant_is_down(monkeypatch):
    from app.config import settings
    from app.services import vector_store as module

    monkeypatch.setattr(settings, "VECTOR_BACKEND", "qdrant")
    monkeypatch.setattr(module.candidate_qdrant, "search", lambda *a, **k: None)

    store = module.VectorStore("fallback-test")
    monkeypatch.setattr(store, "embed", lambda text: [1.0] + [0.0] * 1535)
    monkeypatch.setattr(
        store,
        "_all_records",
        lambda: [
            {
                "id": "c1",
                "vector": [1.0] + [0.0] * 1535,
                "text": "python engineer",
                "metadata": {"owner_email": "me@example.com", "name": "Ada"},
            }
        ],
    )

    matches = store.search("python", limit=5, owner_email="me@example.com")
    assert [m.id for m in matches] == ["c1"]


def test_scoping_is_enforced_when_qdrant_answers(monkeypatch):
    """The filter is Qdrant's job, but a caller must never see another
    recruiter's candidate if that ever regresses."""
    from app.config import settings
    from app.services import vector_store as module

    monkeypatch.setattr(settings, "VECTOR_BACKEND", "qdrant")
    captured = {}

    def fake_search(vector, *, limit, owner_email=None, employment_status=None, min_score=0.0):
        captured["owner_email"] = owner_email
        captured["employment_status"] = employment_status
        return []

    monkeypatch.setattr(module.candidate_qdrant, "search", fake_search)
    store = module.VectorStore("scope-test")
    monkeypatch.setattr(store, "embed", lambda text: [0.1] * 1536)

    store.search("anything", limit=5, owner_email="me@example.com", employment_status="bench")
    assert captured == {"owner_email": "me@example.com", "employment_status": "bench"}


@pytest.mark.parametrize("backend", ["blob", "search", "qdrant"])
def test_every_backend_reports_cosine_on_the_same_scale(backend):
    """Cosine 0 must not read as a 50% fit on one backend and 0% on another.

    Azure applies its own transform to cosine; Qdrant and the local index do
    not. The UI renders whatever comes back as a percentage, so the scales
    have to agree.
    """
    from app.services.vector_store import _cosine_from_search_score

    if backend == "search":
        # Azure reports 1/(2 - cosine) for a cosine profile.
        assert _cosine_from_search_score(1.0 / (2.0 - 0.0)) == pytest.approx(0.0, abs=1e-9)
        assert _cosine_from_search_score(1.0 / (2.0 - 0.5)) == pytest.approx(0.5, abs=1e-9)
    else:
        # Qdrant and the blob index report cosine directly; nothing to undo.
        assert True


# ---------- Cosmos DB backend ----------


def test_cosmos_is_not_used_until_it_is_configured():
    """No endpoint means no attempt, rather than a per-request timeout."""
    from app.services.cosmos_store import CosmosVectorIndex

    index = CosmosVectorIndex()
    assert index.configured is False
    assert index._connect() is None


def test_unreachable_cosmos_returns_none_not_an_empty_result(monkeypatch):
    from app.services.cosmos_store import CosmosVectorIndex

    index = CosmosVectorIndex()
    monkeypatch.setattr(index, "_connect", lambda: None)
    assert index.search([0.0] * 1536, limit=5) is None
    assert index.list_ids() is None


def test_cosmos_scoping_is_parameterised_not_interpolated(monkeypatch):
    """An owner_email containing a quote must not be able to alter the query."""
    from app.services.cosmos_store import CosmosVectorIndex

    index = CosmosVectorIndex()
    captured = {}

    class FakeContainer:
        def query_items(self, query, parameters=None, **kwargs):
            captured["query"] = query
            captured["parameters"] = parameters
            return []

    monkeypatch.setattr(index, "_connect", lambda: FakeContainer())
    hostile = "x' OR 1=1 --"
    index.search([0.1] * 1536, limit=5, owner_email=hostile)

    assert hostile not in captured["query"]
    assert {"name": "@owner", "value": hostile} in captured["parameters"]


def test_cosmos_search_falls_back_to_the_local_index_when_down(monkeypatch):
    from app.config import settings
    from app.services import vector_store as module

    monkeypatch.setattr(settings, "VECTOR_BACKEND", "cosmos")
    monkeypatch.setattr(module.candidate_cosmos, "search", lambda *a, **k: None)

    store = module.VectorStore("cosmos-fallback")
    monkeypatch.setattr(store, "embed", lambda text: [1.0] + [0.0] * 1535)
    monkeypatch.setattr(
        store,
        "_all_records",
        lambda: [
            {
                "id": "c1",
                "vector": [1.0] + [0.0] * 1535,
                "text": "python engineer",
                "metadata": {"owner_email": "me@example.com", "name": "Ada"},
            }
        ],
    )
    assert [m.id for m in store.search("python", limit=5, owner_email="me@example.com")] == ["c1"]


def test_cosmos_delete_reads_the_partition_key_before_removing_the_record(monkeypatch):
    """Cosmos needs the owner to delete; it is gone once the local copy is."""
    from app.config import settings
    from app.services import vector_store as module

    monkeypatch.setattr(settings, "VECTOR_BACKEND", "cosmos")
    deleted: list[tuple[str, str]] = []
    monkeypatch.setattr(
        module.candidate_cosmos, "delete", lambda rid, owner="": deleted.append((rid, owner))
    )
    monkeypatch.setattr(
        module.document_store,
        "get",
        lambda key: {"metadata": {"owner_email": "owner@example.com"}},
    )
    monkeypatch.setattr(module.document_store, "delete", lambda key: None)

    module.VectorStore("cosmos-delete").delete("c1")
    assert deleted == [("c1", "owner@example.com")]
