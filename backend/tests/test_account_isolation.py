"""One account must not see another's candidates or jobs.

Signing in as a new recruiter used to show every candidate and job anyone had
ever created, because the list endpoints read the whole store. These pin the
scoping so that cannot come back.
"""

import io
import uuid

from app.models.candidate import Candidate
from app.models.job_posting import JobPosting

ALICE = {"X-Recruiter-Email": "alice@example.com"}
BOB = {"X-Recruiter-Email": "bob@example.com"}


def _candidate(store, owner: str | None, name: str) -> Candidate:
    candidate = Candidate(
        owner_email=owner,
        name=name,
        email=f"{name.lower().replace(' ', '.')}@example.com",
        skills=["Python"],
    )
    store.candidates.save(candidate)
    return candidate


def _job(store, owner: str | None, title: str) -> JobPosting:
    job = JobPosting(
        title=title,
        description="Build APIs with Python.",
        required_skills=["Python"],
        created_by=owner,
    )
    store.jobs.save(job)
    return job


# ---------- candidates ----------


def test_candidates_list_only_shows_your_own(client, store):
    _candidate(store, "alice@example.com", "Alice Candidate")
    _candidate(store, "bob@example.com", "Bob Candidate")

    names = [c["name"] for c in client.get("/api/candidates", headers=ALICE).json()]
    assert names == ["Alice Candidate"]


def test_candidates_from_before_ownership_are_not_shown_to_everyone(client, store):
    """Legacy records belong to nobody rather than to whoever signs in."""
    _candidate(store, None, "Legacy Candidate")

    assert client.get("/api/candidates", headers=ALICE).json() == []


def test_two_recruiters_can_hold_the_same_person_independently(client, store):
    _candidate(store, "alice@example.com", "Shared Person")
    _candidate(store, "bob@example.com", "Shared Person")

    assert len(client.get("/api/candidates", headers=ALICE).json()) == 1
    assert len(client.get("/api/candidates", headers=BOB).json()) == 1


# ---------- jobs ----------


def test_jobs_list_only_shows_your_own(client, store):
    _job(store, "alice@example.com", "Alice's Role")
    _job(store, "bob@example.com", "Bob's Role")

    titles = [j["title"] for j in client.get("/api/jobs", headers=ALICE).json()]
    assert titles == ["Alice's Role"]


# ---------- ranking ----------


def test_ranking_only_considers_the_job_owner_pool(client, store):
    job = _job(store, "alice@example.com", "Alice's Role")
    _candidate(store, "alice@example.com", "Alice Candidate")
    _candidate(store, "bob@example.com", "Bob Candidate")

    ranked = client.get(f"/api/candidates/rank?job_id={job.id}", headers=ALICE).json()
    assert [r["name"] for r in ranked] == ["Alice Candidate"]


def test_uploaded_resume_is_filed_under_the_uploader(client, store, monkeypatch):
    """The upload path must record an owner, or the candidate it creates is
    invisible to the recruiter who uploaded it."""
    from app.routes import resumes as resumes_module

    monkeypatch.setattr(resumes_module, "store", store)
    response = client.post(
        "/api/resumes/upload",
        files={"files": ("cv.txt", io.BytesIO(b"Dana Reed\ndana.reed@example.com\nSkills: Python\n"), "text/plain")},
        headers=ALICE,
    )
    assert response.status_code == 200

    owned = client.get("/api/candidates", headers=ALICE).json()
    assert any(c["email"] == "dana.reed@example.com" for c in owned), (
        "the uploaded resume should appear in the uploader's candidate list"
    )
    assert client.get("/api/candidates", headers=BOB).json() == []


def test_unknown_job_still_404s(client):
    assert client.get(f"/api/jobs/{uuid.uuid4()}").status_code == 404


def test_same_filename_from_two_recruiters_is_not_a_duplicate(client, store, monkeypatch):
    """Duplicate detection is per account: one recruiter's "resume.pdf" must
    not silently skip another recruiter's upload of the same filename."""
    from app.routes import resumes as resumes_module

    monkeypatch.setattr(resumes_module, "store", store)
    payload = {"files": ("resume.txt", io.BytesIO(b"Ann Lee\nann@example.com\nSkills: Go\n"), "text/plain")}
    first = client.post("/api/resumes/upload", files=payload, headers=ALICE)
    assert first.json()["files"][0]["status"] != "duplicate"

    second = client.post(
        "/api/resumes/upload",
        files={"files": ("resume.txt", io.BytesIO(b"Ben Fox\nben@example.com\nSkills: Rust\n"), "text/plain")},
        headers=BOB,
    )
    assert second.json()["files"][0]["status"] != "duplicate", (
        "another account's upload must not be treated as a duplicate"
    )


def test_the_same_recruiter_uploading_twice_is_still_a_duplicate(client, store, monkeypatch):
    from app.routes import resumes as resumes_module

    monkeypatch.setattr(resumes_module, "store", store)
    for _ in range(1):
        client.post(
            "/api/resumes/upload",
            files={"files": ("cv.txt", io.BytesIO(b"Ann Lee\nann@example.com\nSkills: Go\n"), "text/plain")},
            headers=ALICE,
        )
    again = client.post(
        "/api/resumes/upload",
        files={"files": ("cv.txt", io.BytesIO(b"Ann Lee\nann@example.com\nSkills: Go\n"), "text/plain")},
        headers=ALICE,
    )
    assert again.json()["files"][0]["duplicate"] is True


def test_dashboard_jobs_only_shows_your_own(client, store):
    """The sidebar and dashboard read this endpoint — unscoped, a new account
    saw every job on the deployment."""
    _job(store, "alice@example.com", "Alice's Role")
    _job(store, "bob@example.com", "Bob's Role")

    titles = [j["title"] for j in client.get("/api/dashboard/jobs", headers=ALICE).json()]
    assert titles == ["Alice's Role"]


def test_unknown_job_pipeline_does_not_fall_back_to_another_job(client, store):
    """A mistyped id used to return whichever job was first in the store —
    which, once jobs are owner-scoped, is another recruiter's pipeline."""
    _job(store, "bob@example.com", "Bob's Role")

    response = client.get(f"/api/dashboard/jobs/{uuid.uuid4()}/pipeline", headers=ALICE)
    assert response.status_code == 404


def test_another_recruiters_job_pipeline_is_not_readable(client, store):
    theirs = _job(store, "bob@example.com", "Bob's Role")
    assert client.get(f"/api/dashboard/jobs/{theirs.id}/pipeline", headers=ALICE).status_code == 404
