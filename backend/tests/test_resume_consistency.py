import uuid

from fastapi.testclient import TestClient

from app.models.candidate import Candidate
from app.services.resume_consistency_service import Flag, _requires_review
from app.storage.store import Store


def _make_candidate(store: Store, resume_text: str, **overrides) -> Candidate:
    candidate = Candidate(
        owner_email="recruiter@example.com",
        id=uuid.uuid4(),
        name=overrides.pop("name", "Test Candidate"),
        email=overrides.pop("email", "test.candidate@example.com"),
        resume_text=resume_text,
        **overrides,
    )
    store.candidates.save(candidate)
    return candidate


def test_consistency_check_404_for_unknown_candidate(client: TestClient):
    resp = client.post(f"/api/fraud/consistency-check/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_sample_candidate_has_exactly_two_missing_document_flags(client: TestClient, sample_candidate):
    assert (
        sample_candidate.resume_text
        == "Alice Johnson. Skills: Python, SQL, Azure, Docker. Built APIs for 4 years."
    )

    resp = client.post(f"/api/fraud/consistency-check/{sample_candidate.id}")
    assert resp.status_code == 200
    body = resp.json()

    assert body["engine"] == "heuristic"
    missing_doc_flags = [f for f in body["flags"] if f["category"] == "missing_document"]
    assert len(missing_doc_flags) == 2
    assert body["flagged_count"] == 2
    categories = {f["category"] for f in missing_doc_flags}
    assert categories == {"missing_document"}


def test_overlapping_positions_flagged(client: TestClient, store: Store):
    text = (
        "Experience:\n"
        "2018 - 2021 Software Engineer, Acme\n"
        "2019 - 2022 Product Manager, Beta\n"
        "Education: BSc\n"
        "Skills: Python"
    )
    candidate = _make_candidate(store, text)

    resp = client.post(f"/api/fraud/consistency-check/{candidate.id}")
    assert resp.status_code == 200
    body = resp.json()

    categories = {f["category"] for f in body["flags"]}
    assert "overlapping_positions" in categories


def test_date_conflict_end_before_start_flagged(client: TestClient, store: Store):
    text = (
        "Experience: Software Engineer at Acme\n"
        "2022 - 2019\n"
        "Education: BSc\n"
        "Skills: Python"
    )
    candidate = _make_candidate(store, text)

    resp = client.post(f"/api/fraud/consistency-check/{candidate.id}")
    assert resp.status_code == 200
    body = resp.json()

    date_flags = [f for f in body["flags"] if f["category"] == "date_conflict"]
    assert len(date_flags) == 1
    assert date_flags[0]["severity"] == "high"
    assert body["requires_review"] is True


def test_inflated_experience_flagged(client: TestClient, store: Store):
    text = (
        "Experience: 10 years of experience. Software Engineer at Acme\n"
        "2020 - 2021\n"
        "Education: BSc\n"
        "Skills: Python"
    )
    candidate = _make_candidate(store, text)

    resp = client.post(f"/api/fraud/consistency-check/{candidate.id}")
    assert resp.status_code == 200
    body = resp.json()

    inflated_flags = [f for f in body["flags"] if f["category"] == "inflated_experience"]
    assert len(inflated_flags) == 1
    assert inflated_flags[0]["severity"] == "high"


def test_clean_resume_has_zero_flags(client: TestClient, store: Store):
    text = (
        "John Smith\n\n"
        "Education: BSc Computer Science\n"
        "Experience: Software Engineer at TechCorp\n"
        "2018 - 2020\n"
        "Skills: Python, Java"
    )
    candidate = _make_candidate(store, text)

    resp = client.post(f"/api/fraud/consistency-check/{candidate.id}")
    assert resp.status_code == 200
    body = resp.json()

    assert body["flags"] == []
    assert body["flagged_count"] == 0
    assert body["requires_review"] is False


def test_batch_skips_unknown_ids(client: TestClient, sample_candidate):
    unknown_id = uuid.uuid4()
    resp = client.post(
        "/api/fraud/consistency-check/batch",
        json={"candidate_ids": [str(sample_candidate.id), str(unknown_id)]},
    )
    assert resp.status_code == 200
    body = resp.json()

    assert len(body["results"]) == 1
    assert body["results"][0]["candidate_id"] == str(sample_candidate.id)


def test_requires_review_threshold_logic():
    assert _requires_review([]) is False
    assert _requires_review([Flag(id="a", category="x", label="l", severity="low")]) is False
    assert (
        _requires_review(
            [
                Flag(id="a", category="x", label="l", severity="medium"),
                Flag(id="b", category="y", label="l", severity="low"),
            ]
        )
        is False
    )
    assert (
        _requires_review(
            [
                Flag(id="a", category="x", label="l", severity="medium"),
                Flag(id="b", category="y", label="l", severity="medium"),
            ]
        )
        is True
    )
    assert _requires_review([Flag(id="a", category="x", label="l", severity="high")]) is True
