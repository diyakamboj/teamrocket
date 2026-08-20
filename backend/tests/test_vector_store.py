"""Vector index: persistence, scoping and retrieval.

Embeddings are stubbed so these assert the index's own behaviour — what gets
stored, who can retrieve it, and that ranking is by similarity — rather than
the embedding model's quality.
"""

import pytest

from app.models.candidate import Candidate
from app.services import vector_store as vector_module
from app.services.vector_store import VectorStore, candidate_document, cosine


@pytest.fixture()
def store_with_stub_embeddings(store, monkeypatch):
    """A vector store whose embeddings are deterministic keyword vectors."""
    monkeypatch.setattr(vector_module, "document_store", store.candidates._store)

    AXES = ["kubernetes", "react", "python", "sql"]

    def fake_embed(texts):
        vectors = []
        for text in texts:
            lowered = text.lower()
            vectors.append([1.0 if axis in lowered else 0.0 for axis in AXES])
        return vectors

    monkeypatch.setattr(vector_module.openai_service, "embed_texts", fake_embed)
    monkeypatch.setattr(vector_module.openai_service, "embeddings_mock", False)
    return VectorStore("candidates")


def test_cosine_is_one_for_identical_vectors():
    assert cosine([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)


def test_cosine_is_zero_for_orthogonal_vectors():
    assert cosine([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)


def test_cosine_handles_a_zero_vector_without_dividing_by_zero():
    assert cosine([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_upsert_then_search_finds_the_record(store_with_stub_embeddings):
    index = store_with_stub_embeddings
    assert index.upsert("c1", "Kubernetes and Terraform", {"owner_email": "a@x.com"})

    matches = index.search("kubernetes")
    assert [m.id for m in matches] == ["c1"]
    assert matches[0].score > 0


def test_search_ranks_by_similarity(store_with_stub_embeddings):
    index = store_with_stub_embeddings
    index.upsert("sre", "kubernetes", {"owner_email": "a@x.com"})
    index.upsert("fe", "react", {"owner_email": "a@x.com"})

    assert [m.id for m in index.search("kubernetes")][0] == "sre"
    assert [m.id for m in index.search("react")][0] == "fe"


def test_search_is_scoped_by_predicate(store_with_stub_embeddings):
    """One recruiter's search must not reach another's pool."""
    index = store_with_stub_embeddings
    index.upsert("mine", "kubernetes", {"owner_email": "alice@x.com"})
    index.upsert("theirs", "kubernetes", {"owner_email": "bob@x.com"})

    matches = index.search("kubernetes", predicate=lambda m: m["owner_email"] == "alice@x.com")
    assert [m.id for m in matches] == ["mine"]


def test_vectors_persist_across_store_instances(store_with_stub_embeddings):
    """The point of the index: embeddings survive rather than being recomputed."""
    store_with_stub_embeddings.upsert("c1", "kubernetes", {"owner_email": "a@x.com"})

    fresh = VectorStore("candidates")
    assert [m.id for m in fresh.search("kubernetes")] == ["c1"]


def test_deleting_a_record_removes_it_from_results(store_with_stub_embeddings):
    index = store_with_stub_embeddings
    index.upsert("c1", "kubernetes", {"owner_email": "a@x.com"})
    index.delete("c1")

    assert index.search("kubernetes") == []


def test_limit_caps_the_result_count(store_with_stub_embeddings):
    index = store_with_stub_embeddings
    for i in range(5):
        index.upsert(f"c{i}", "kubernetes python", {"owner_email": "a@x.com"})

    assert len(index.search("kubernetes", limit=3)) == 3


def test_min_score_filters_weak_matches(store_with_stub_embeddings):
    index = store_with_stub_embeddings
    index.upsert("match", "kubernetes", {"owner_email": "a@x.com"})
    index.upsert("unrelated", "sql", {"owner_email": "a@x.com"})

    assert [m.id for m in index.search("kubernetes", min_score=0.5)] == ["match"]


def test_upsert_reports_failure_when_embeddings_are_unavailable(store, monkeypatch):
    """A candidate that could not be embedded is not silently 'indexed'."""
    monkeypatch.setattr(vector_module, "document_store", store.candidates._store)
    monkeypatch.setattr(vector_module.openai_service, "embed_texts", lambda texts: None)

    assert VectorStore("candidates").upsert("c1", "anything", {}) is False


# ---------- what a candidate is embedded from ----------


def test_candidate_document_includes_the_signal_fields():
    candidate = Candidate(
        name="Maya Okonkwo",
        email="maya@example.com",
        title="Site Reliability Engineer",
        skills=["Kubernetes", "Terraform"],
        experience=[{"title": "SRE", "company": "Cloudspan", "description": "Ran EKS clusters"}],
    )
    document = candidate_document(candidate)

    assert "Site Reliability Engineer" in document
    assert "Kubernetes" in document
    assert "Ran EKS clusters" in document


def test_candidate_document_leaves_out_contact_noise():
    """Email and phone dilute the vector without carrying hiring signal."""
    candidate = Candidate(
        name="Maya Okonkwo",
        email="maya@example.com",
        phone="+1 555 0100",
        skills=["Kubernetes"],
    )
    document = candidate_document(candidate)

    assert "maya@example.com" not in document
    assert "555" not in document
