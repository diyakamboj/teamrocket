"""Company context documents: upload, extraction, and access scoping.

The security properties matter more than the happy path here — these are
files a recruiter uploaded about their own organisation, and the app has no
real auth beyond the recruiter header.
"""

import io
import uuid

import pytest

from app.utils.validators import safe_upload_filename


ALICE = {"X-Recruiter-Email": "alice@example.com"}
BOB = {"X-Recruiter-Email": "bob@example.com"}


def _upload(client, headers=ALICE, name="culture.txt", body=b"We value transparency.", category="culture"):
    return client.post(
        "/api/company-documents",
        files={"file": (name, io.BytesIO(body), "text/plain")},
        data={"category": category},
        headers=headers,
    )


# ---------- upload + extraction ----------


def test_upload_stores_the_document_and_extracts_its_text(client, store, monkeypatch):
    # `process_document` runs as a BackgroundTask outside FastAPI's DI scope,
    # so it uses the module-level store singleton (the same pattern as
    # attachment and resume processing). Point it at this test's store.
    from app.services import company_document_service

    monkeypatch.setattr(company_document_service, "store", store)

    response = _upload(client, body=b"Our vision is to hire for potential, not pedigree.")
    assert response.status_code == 201
    document = response.json()
    assert document["category"] == "culture"
    assert document["filename"] == "culture.txt"

    # Processing runs as a background task, which TestClient completes before
    # the response context exits.
    fetched = client.get(f"/api/company-documents/{document['id']}", headers=ALICE).json()
    assert fetched["status"] == "processed"
    assert "hire for potential" in (fetched["extracted_text"] or "")
    assert fetched["extracted_summary"]


def test_listing_returns_only_your_own_documents(client):
    _upload(client, headers=ALICE, name="alice.txt")
    _upload(client, headers=BOB, name="bob.txt")

    alice_docs = client.get("/api/company-documents", headers=ALICE).json()
    assert [d["filename"] for d in alice_docs] == ["alice.txt"]


def test_another_recruiter_cannot_read_your_document(client):
    document_id = _upload(client, headers=ALICE).json()["id"]

    response = client.get(f"/api/company-documents/{document_id}", headers=BOB)
    assert response.status_code == 404, "another recruiter must not read the document"


def test_another_recruiter_cannot_delete_your_document(client):
    document_id = _upload(client, headers=ALICE).json()["id"]

    assert client.delete(f"/api/company-documents/{document_id}", headers=BOB).status_code == 404
    assert client.get(f"/api/company-documents/{document_id}", headers=ALICE).status_code == 200


def test_owner_can_delete_their_document(client):
    document_id = _upload(client, headers=ALICE).json()["id"]

    assert client.delete(f"/api/company-documents/{document_id}", headers=ALICE).status_code == 204
    assert client.get(f"/api/company-documents/{document_id}", headers=ALICE).status_code == 404


def test_unknown_document_is_404(client):
    assert client.get(f"/api/company-documents/{uuid.uuid4()}", headers=ALICE).status_code == 404


# ---------- input validation ----------


def test_executable_upload_is_rejected(client):
    response = _upload(client, name="payload.exe", body=b"MZ\x90\x00")
    assert response.status_code == 422


def test_image_upload_is_rejected(client):
    """Company docs are prose; images would only be readable via OCR."""
    assert _upload(client, name="poster.png", body=b"\x89PNG\r\n").status_code == 422


def test_empty_file_is_rejected(client):
    assert _upload(client, body=b"").status_code == 422


def test_oversized_file_is_rejected(client):
    from app.utils.validators import MAX_COMPANY_DOC_SIZE_BYTES

    assert _upload(client, body=b"x" * (MAX_COMPANY_DOC_SIZE_BYTES + 1)).status_code == 422


def test_unknown_category_is_rejected(client):
    assert _upload(client, category="not-a-category").status_code == 422


def test_traversing_filename_is_neutralised(client):
    document = _upload(client, name="../../etc/passwd.txt").json()
    assert document["filename"] == "passwd.txt"
    assert "/" not in document["filename"]
    assert not document["blob_path"].endswith("/etc/passwd.txt")


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("../../secrets.txt", "secrets.txt"),
        ("company values.pdf", "company_values.pdf"),
        ("..\\\\..\\\\win.docx", "win.docx"),
        ("", "upload"),
        (".env", "env"),
    ],
)
def test_filename_sanitisation(raw, expected):
    assert safe_upload_filename(raw) == expected


# ---------- copilot context ----------


def test_processed_documents_become_copilot_context(client, store, monkeypatch):
    from app.services import company_document_service

    monkeypatch.setattr(company_document_service, "store", store)
    _upload(client, body=b"We promote from within wherever possible.")

    context = company_document_service.context_for_recruiter("alice@example.com")
    assert "culture.txt" in context


def test_context_is_empty_for_a_recruiter_with_no_documents(store, monkeypatch):
    from app.services import company_document_service

    monkeypatch.setattr(company_document_service, "store", store)
    assert company_document_service.context_for_recruiter("nobody@example.com") == ""


# ---------- text extraction ----------


def test_markdown_and_text_are_read_without_the_ocr_service():
    """`prebuilt-read` rejects text formats, and they need no OCR anyway —
    a Markdown culture doc used to fail extraction entirely."""
    from app.services.azure_services import AzureDocumentIntelligenceService

    service = AzureDocumentIntelligenceService()
    service.mock = False
    service._client = None  # any call to the OCR service would raise

    assert "Culture" in service.extract_text(b"# Culture\n\nWe value clarity.", "culture.md")
    assert "clarity" in service.extract_text(b"We value clarity.", "notes.txt")


def test_extraction_falls_back_to_local_parsing_when_ocr_fails(monkeypatch):
    from app.services.azure_services import AzureDocumentIntelligenceService

    service = AzureDocumentIntelligenceService()
    service.mock = False

    class BrokenClient:
        def begin_analyze_document(self, *_args, **_kwargs):
            raise RuntimeError("service unavailable")

    service._client = BrokenClient()
    monkeypatch.setattr(
        AzureDocumentIntelligenceService,
        "_extract_pdf_or_docx_fallback",
        lambda self, data, name: "Recovered locally",
    )

    assert service.extract_text(b"%PDF-1.4", "handbook.pdf") == "Recovered locally"
