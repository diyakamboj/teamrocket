"""Chat-attachment upload -> background processing tests."""

import io

SAMPLE_RESUME_TEXT = """Jordan Rivera
jordan.rivera@example.com
Skills: Python, SQL, Azure, Docker, FastAPI
Experience: Backend engineer for 5 years building APIs on Azure.
Education: BSc Computer Science
Projects: Resume screening assistant
"""


def test_attachment_upload_processes_to_processed_status(client, store, monkeypatch):
    # `_process_attachment` runs as a BackgroundTask outside FastAPI's DI
    # scope, so it reads/writes the module-level `store` singleton in
    # `attachment_processor.py` (mirrors `resumes.py::_process_resume`'s
    # documented pattern) rather than the per-test isolated store the
    # `client`/`store` fixtures give every other assertion here. Point that
    # singleton at the same isolated store for this test so the background
    # task's writes are visible to the assertions below.
    from app.services import attachment_processor as attachment_processor_module

    monkeypatch.setattr(attachment_processor_module, "store", store)

    response = client.post(
        "/api/agent/attachments",
        files={"file": ("sample_resume.txt", io.BytesIO(SAMPLE_RESUME_TEXT.encode("utf-8")), "text/plain")},
    )
    assert response.status_code == 200
    body = response.json()
    attachment_id = body["id"]
    assert body["filename"] == "sample_resume.txt"

    # TestClient runs BackgroundTasks to completion before the response is
    # returned, so the attachment should already be past "queued" — poll a
    # few times regardless, to be resilient to that implementation detail.
    status = body["status"]
    for _ in range(5):
        if status == "processed":
            break
        poll = client.get(f"/api/agent/attachments/{attachment_id}")
        assert poll.status_code == 200
        status = poll.json()["status"]

    assert status == "processed"


def test_get_attachment_not_found(client):
    import uuid

    response = client.get(f"/api/agent/attachments/{uuid.uuid4()}")
    assert response.status_code == 404


def test_attachment_upload_rejects_bad_extension(client):
    response = client.post(
        "/api/agent/attachments",
        files={"file": ("malware.exe", io.BytesIO(b"nope"), "application/octet-stream")},
    )
    assert response.status_code == 422


def test_attachment_is_not_readable_by_another_recruiter(client):
    """The record holds the file's extracted text, so an id alone must not
    be enough to read someone else's upload."""
    uploaded = client.post(
        "/api/agent/attachments",
        files={"file": ("notes.txt", io.BytesIO(b"internal notes"), "text/plain")},
        headers={"X-Recruiter-Email": "alice@example.com"},
    ).json()

    response = client.get(
        f"/api/agent/attachments/{uploaded['id']}",
        headers={"X-Recruiter-Email": "mallory@example.com"},
    )
    assert response.status_code == 404


def test_attachment_is_readable_by_its_owner(client):
    uploaded = client.post(
        "/api/agent/attachments",
        files={"file": ("notes.txt", io.BytesIO(b"internal notes"), "text/plain")},
        headers={"X-Recruiter-Email": "alice@example.com"},
    ).json()

    response = client.get(
        f"/api/agent/attachments/{uploaded['id']}",
        headers={"X-Recruiter-Email": "alice@example.com"},
    )
    assert response.status_code == 200
