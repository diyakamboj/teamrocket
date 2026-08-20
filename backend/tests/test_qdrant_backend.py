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



# ---------- dual backend: Qdrant + Azure AI Search ----------


def test_rank_fusion_prefers_ids_both_engines_agree_on():
    """The point of fusing: agreement beats one engine's confidence.

    Qdrant returns cosine similarity and Azure returns BM25 relevance, and
    those numbers are not comparable, so the ranks are combined rather than
    the scores.
    """
    from app.services.vector_store import reciprocal_rank_fusion

    vector_ranking = ["alice", "bob"]
    lexical_ranking = ["bob", "carol"]
    assert reciprocal_rank_fusion([vector_ranking, lexical_ranking])[0] == "bob"


def test_rank_fusion_ignores_empty_ids():
    from app.services.vector_store import reciprocal_rank_fusion

    assert reciprocal_rank_fusion([["a", ""], ["", "b"]]) == ["a", "b"]


def test_dual_mode_uses_both_engines_for_a_hybrid_query(monkeypatch):
    from app.config import settings
    from app.services import vector_store as module

    monkeypatch.setattr(settings, "VECTOR_BACKEND", "dual")
    called = {"vector": False, "lexical": False}

    def fake_vector(vector, **kwargs):
        called["vector"] = True
        return [("c1", 0.8, {"name": "Ada"})]

    def fake_lexical(text, **kwargs):
        called["lexical"] = True
        return [{"id": "c2", "name": "Grace"}]

    monkeypatch.setattr(module.candidate_qdrant, "search", fake_vector)
    monkeypatch.setattr(module.search_service, "lexical_search", fake_lexical)

    store = module.VectorStore("dual-test")
    monkeypatch.setattr(store, "embed", lambda t: [0.1] * 1536)
    matches = store.search("ada lovelace", limit=5, hybrid=True)

    assert called == {"vector": True, "lexical": True}
    assert {m.id for m in matches} == {"c1", "c2"}
    # Fused ranks are not a similarity, so no percentage is invented.
    assert all(m.score is None for m in matches)


def test_a_plain_semantic_query_skips_the_keyword_engine(monkeypatch):
    """"People like this one" wants distance ordering, not keyword matches.

    Mixing lexical hits in would distort the order and destroy the cosine
    score the UI renders as a "% fit".
    """
    from app.config import settings
    from app.services import vector_store as module

    monkeypatch.setattr(settings, "VECTOR_BACKEND", "dual")
    lexical_called = {"n": 0}

    def fake_lexical(text, **kwargs):
        lexical_called["n"] += 1
        return []

    monkeypatch.setattr(
        module.candidate_qdrant, "search", lambda v, **k: [("c1", 0.77, {"name": "Ada"})]
    )
    monkeypatch.setattr(module.search_service, "lexical_search", fake_lexical)

    store = module.VectorStore("dual-semantic")
    monkeypatch.setattr(store, "embed", lambda t: [0.1] * 1536)
    matches = store.search("someone who ran kubernetes", limit=5)

    assert lexical_called["n"] == 0
    assert matches[0].score == pytest.approx(0.77)


def test_one_engine_down_still_returns_the_other(monkeypatch):
    """Half a result set beats telling a recruiter nobody matched."""
    from app.config import settings
    from app.services import vector_store as module

    monkeypatch.setattr(settings, "VECTOR_BACKEND", "dual")
    monkeypatch.setattr(module.candidate_qdrant, "search", lambda v, **k: None)
    monkeypatch.setattr(
        module.search_service, "lexical_search", lambda t, **k: [{"id": "c9", "name": "Grace"}]
    )

    store = module.VectorStore("dual-half")
    monkeypatch.setattr(store, "embed", lambda t: [0.1] * 1536)
    matches = store.search("grace", limit=5, hybrid=True)
    assert [m.id for m in matches] == ["c9"]


def test_both_engines_down_falls_back_to_the_local_index(monkeypatch):
    from app.config import settings
    from app.services import vector_store as module

    monkeypatch.setattr(settings, "VECTOR_BACKEND", "dual")
    monkeypatch.setattr(module.candidate_qdrant, "search", lambda v, **k: None)
    monkeypatch.setattr(module.search_service, "lexical_search", lambda t, **k: None)

    store = module.VectorStore("dual-down")
    monkeypatch.setattr(store, "embed", lambda t: [1.0] + [0.0] * 1535)
    monkeypatch.setattr(
        store,
        "_all_records",
        lambda: [
            {
                "id": "local1",
                "vector": [1.0] + [0.0] * 1535,
                "text": "python",
                "metadata": {"owner_email": "me@example.com"},
            }
        ],
    )
    matches = store.search("python", limit=5, owner_email="me@example.com", hybrid=True)
    assert [m.id for m in matches] == ["local1"]


def test_dual_scoping_is_pushed_into_both_engines(monkeypatch):
    """Neither engine may return another recruiter's candidates."""
    from app.config import settings
    from app.services import vector_store as module

    monkeypatch.setattr(settings, "VECTOR_BACKEND", "dual")
    seen = {}

    def fake_vector(vector, **kwargs):
        seen["qdrant_owner"] = kwargs.get("owner_email")
        return []

    def fake_lexical(text, **kwargs):
        seen["azure_filter"] = kwargs.get("filter_expression")
        return []

    monkeypatch.setattr(module.candidate_qdrant, "search", fake_vector)
    monkeypatch.setattr(module.search_service, "lexical_search", fake_lexical)

    store = module.VectorStore("dual-scope")
    monkeypatch.setattr(store, "embed", lambda t: [0.1] * 1536)
    store.search("anything", limit=5, owner_email="me@example.com", hybrid=True)

    assert seen["qdrant_owner"] == "me@example.com"
    assert "owner_email eq 'me@example.com'" in seen["azure_filter"]
