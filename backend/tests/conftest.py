import copy
import os
import uuid
from typing import Generator, Optional

import pytest
from fastapi.testclient import TestClient

# Force mock Azure before app imports. Search and embeddings are
# deliberately decoupled from USE_MOCK_AZURE (see azure_services.py) so they
# can go live independently of the chat deployment — which means they need
# to be muted here explicitly, or tests would make real network calls.
os.environ["USE_MOCK_AZURE"] = "true"
os.environ["DEBUG"] = "true"
os.environ["AZURE_SEARCH_ENDPOINT"] = ""
os.environ["AZURE_SEARCH_ADMIN_KEY"] = ""
os.environ["AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME"] = ""

from app.main import app
from app.models.candidate import Candidate
from app.models.job_posting import JobPosting
from app.storage.store import Store, get_store

#: The recruiter the sample job and candidates belong to. Ownership is
#: enforced now, so fixtures have to agree on who owns what.
RECRUITER_EMAIL = "recruiter@example.com"


class InMemoryJsonBlobStore:
    """Dict-backed stand-in for `JsonBlobStore`, same interface (put/get/
    get_many/put_many/delete/delete_many/exists/list_prefix). Gives each test
    a trivially-reset, fully-isolated backing store — no real disk I/O, no
    shared state between tests, no need for the old drop-all/create-all
    SQLAlchemy dance.

    The batch methods exist because the real store batches: they are what
    the repositories call, so the double has to answer them too. `immutable`
    and `strict` are accepted and ignored — they only affect how the real
    store talks to Blob Storage, not what is stored.
    """

    def __init__(self) -> None:
        self._data: dict[str, dict] = {}

    def put(self, key: str, doc: dict) -> None:
        self._data[key] = copy.deepcopy(doc)

    def put_many(self, items: list[tuple[str, dict]], *, strict: bool = False) -> None:
        for key, doc in items:
            self.put(key, doc)

    def get(self, key: str) -> Optional[dict]:
        doc = self._data.get(key)
        return copy.deepcopy(doc) if doc is not None else None

    def get_many(self, keys: list[str]) -> list[Optional[dict]]:
        return [self.get(key) for key in keys]

    def delete(self, key: str) -> None:
        self._data.pop(key, None)

    def delete_many(self, keys: list[str]) -> None:
        for key in keys:
            self.delete(key)

    def exists(self, key: str) -> bool:
        return key in self._data

    def list_prefix(self, prefix: str, *, immutable: bool = False) -> list[str]:
        prefix = prefix.strip("/")
        if not prefix:
            return sorted(self._data.keys())
        needle = f"{prefix}/"
        return sorted(key for key in self._data if key.startswith(needle))


@pytest.fixture(autouse=True)
def never_send_real_email(monkeypatch):
    """No test may put a message on the wire.

    Once real SMTP credentials landed in .env the suite started delivering
    genuine mail to the fixtures' example.com addresses on every run --
    bouncing messages from the operator's own mailbox, and a fast way to get
    an account rate-limited. Tests that exercise the live send path build
    their own EmailService with a stubbed transport instead.
    """
    from app.services.email_service import email_service

    monkeypatch.setattr(email_service, "mock", True)


@pytest.fixture(autouse=True)
def no_external_vector_backend(monkeypatch):
    """Keep tests off Azure Search and Qdrant.

    Whichever backend .env selects, the suite uses the in-process blob index
    so a test run neither depends on a network service nor writes into the
    real one.
    """
    from app.config import settings

    monkeypatch.setattr(settings, "VECTOR_BACKEND", "blob")


@pytest.fixture()
def store() -> Generator[Store, None, None]:
    yield Store(InMemoryJsonBlobStore())


@pytest.fixture()
def db(store: Store) -> Store:
    """Alias for `store`. Most tests predate the blob-store rewrite and pass
    a fixture named `db` straight through to service calls — that still
    works unchanged since services only care that it quacks like a Store.
    """
    return store


@pytest.fixture()
def client(store: Store) -> Generator[TestClient, None, None]:
    def _override_get_store() -> Store:
        return store

    app.dependency_overrides[get_store] = _override_get_store
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def isolated_sre_store(monkeypatch) -> InMemoryJsonBlobStore:
    """`app.services.sre_events` writes to the module-level `document_store`
    singleton directly (not the per-test `store`/`get_store` override —
    see that module's docstring for why), so isolate it separately here.
    """
    from app.services import sre_events

    fake_store = InMemoryJsonBlobStore()
    monkeypatch.setattr(sre_events, "document_store", fake_store)
    return fake_store


@pytest.fixture()
def sample_job(store: Store) -> JobPosting:
    job = JobPosting(
        id=uuid.uuid4(),
        title="Backend Engineer",
        description="Build APIs with Python, FastAPI, SQL, and Azure. Docker preferred.",
        required_skills=["Python", "SQL", "Azure", "Docker"],
        required_experience_years=3,
        education_requirements="Bachelor's in Computer Science",
        nice_to_have_skills=["Kubernetes"],
        created_by=RECRUITER_EMAIL,
    )
    store.jobs.save(job)
    return job


@pytest.fixture()
def sample_candidate(store: Store) -> Candidate:
    candidate = Candidate(
        id=uuid.uuid4(),
        owner_email=RECRUITER_EMAIL,
        name="Alice Johnson",
        email="alice.johnson@example.com",
        phone="+1-555-1111",
        resume_text="Alice Johnson. Skills: Python, SQL, Azure, Docker. Built APIs for 4 years.",
        skills=["Python", "SQL", "Azure", "Docker"],
        experience=[
            {
                "company": "Acme",
                "title": "Software Engineer",
                "years": 4,
                "description": "Built Python APIs on Azure",
            }
        ],
        education=[{"school": "State U", "degree": "BSc", "field": "Computer Science"}],
        certifications=["AZ-900"],
        projects=[{"name": "API Platform", "description": "FastAPI service", "technologies": ["Python"]}],
    )
    store.candidates.save(candidate)
    return candidate
