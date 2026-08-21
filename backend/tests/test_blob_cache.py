"""ETag-validated document cache.

The cache turns a re-read of an unchanged collection into a single LIST, so
these tests pin down when a cached copy may be served and — more importantly
— when it must not be.
"""

import pytest

from app.services import azure_services
from app.services.azure_services import JsonBlobStore


class FakeDownloader:
    def __init__(self, data: bytes, etag: str) -> None:
        self._data = data
        self.properties = type("Props", (), {"etag": etag})()

    def readall(self) -> bytes:
        return self._data


class FakeBlobProperties:
    def __init__(self, name: str, etag: str) -> None:
        self.name = name
        self.etag = etag


class FakeBlob:
    def __init__(self, container: "FakeContainer", name: str) -> None:
        self._container = container
        self._name = name

    def upload_blob(self, data, overwrite=True, content_settings=None):
        return self._container.write(self._name, data)

    def download_blob(self):
        self._container.downloads += 1
        return self._container.read(self._name)

    def delete_blob(self):
        self._container.blobs.pop(self._name, None)

    def exists(self):
        return self._name in self._container.blobs


class FakeContainer:
    """Minimal stand-in for a blob container that counts network reads."""

    def __init__(self) -> None:
        self.blobs: dict[str, tuple[bytes, str]] = {}
        self.downloads = 0
        self.listings = 0
        self._seq = 0

    def write(self, name, data):
        self._seq += 1
        etag = f'"etag-{self._seq}"'
        self.blobs[name] = (data, etag)
        return {"etag": etag}

    def read(self, name):
        data, etag = self.blobs[name]
        return FakeDownloader(data, etag)

    def get_blob_client(self, name):
        return FakeBlob(self, name)

    def list_blobs(self, name_starts_with=""):
        self.listings += 1
        return [
            FakeBlobProperties(name, etag)
            for name, (_, etag) in sorted(self.blobs.items())
            if name.startswith(name_starts_with)
        ]

    def list_blob_names(self, name_starts_with=""):
        self.listings += 1
        return [name for name in sorted(self.blobs) if name.startswith(name_starts_with)]

    def external_write(self, name: str, data: bytes) -> None:
        """A write made behind the store's back, as another process would."""
        self.write(name, data)


class FakeClient:
    def __init__(self, container: FakeContainer) -> None:
        self._container = container

    def get_container_client(self, container):
        return self._container

    def get_blob_client(self, container, blob):
        return self._container.get_blob_client(blob)


class FakeBlobService:
    mock = False
    container = "resumes"

    def __init__(self, container: FakeContainer) -> None:
        self._client = FakeClient(container)


@pytest.fixture()
def container() -> FakeContainer:
    return FakeContainer()


@pytest.fixture()
def store(container, monkeypatch) -> JsonBlobStore:
    monkeypatch.setattr(azure_services.settings, "BLOB_CACHE_ENABLED", True)
    monkeypatch.setattr(azure_services.settings, "BLOB_LISTING_CACHE_SECONDS", 0)
    return JsonBlobStore(FakeBlobService(container), prefix="documents")


def test_a_document_we_just_wrote_is_read_without_a_download(store, container):
    store.put("candidates/a.json", {"name": "Ada"})
    assert store.get("candidates/a.json") == {"name": "Ada"}
    assert container.downloads == 0


def test_second_read_of_unchanged_document_serves_from_cache(store, container):
    container.external_write("documents/candidates/a.json", b'{"name": "Ada"}')
    store.list_prefix("candidates")

    assert store.get("candidates/a.json") == {"name": "Ada"}
    assert store.get("candidates/a.json") == {"name": "Ada"}
    assert container.downloads == 1


def test_a_changed_etag_forces_a_refetch(store, container):
    store.put("candidates/a.json", {"name": "Ada"})
    container.external_write("documents/candidates/a.json", b'{"name": "Grace"}')

    store.list_prefix("candidates")  # reports the new ETag
    assert store.get("candidates/a.json") == {"name": "Grace"}


def test_stale_copy_is_never_served_through_get_many(store, container):
    store.put("candidates/a.json", {"name": "Ada"})
    container.external_write("documents/candidates/a.json", b'{"name": "Grace"}')
    store.list_prefix("candidates")

    assert store.get_many(["candidates/a.json"]) == [{"name": "Grace"}]


def test_get_many_downloads_only_what_changed(store, container):
    for i in range(5):
        store.put(f"candidates/{i}.json", {"n": i})
    keys = store.list_prefix("candidates")
    container.downloads = 0

    container.external_write("documents/candidates/3.json", b'{"n": 99}')
    store.list_prefix("candidates")
    docs = store.get_many(keys)

    assert docs[3] == {"n": 99}
    assert container.downloads == 1


def test_get_many_preserves_order(store, container):
    for i in range(6):
        store.put(f"candidates/{i}.json", {"n": i})
    keys = [f"candidates/{i}.json" for i in [3, 0, 5, 1]]
    assert [d["n"] for d in store.get_many(keys)] == [3, 0, 5, 1]


def test_immutable_listing_serves_cached_documents_without_revalidating(store, container):
    store.put("audit_logs/1.json", {"action": "ranked"})
    container.downloads = 0

    store.list_prefix("audit_logs", immutable=True)
    assert store.get("audit_logs/1.json") == {"action": "ranked"}
    assert container.downloads == 0


def test_deleted_documents_are_evicted(store, container):
    store.put("candidates/a.json", {"name": "Ada"})
    store.delete("candidates/a.json")
    assert store.get("candidates/a.json") is None


def test_cached_documents_are_copies_so_callers_cannot_corrupt_the_cache(store):
    store.put("candidates/a.json", {"skills": ["Python"]})
    first = store.get("candidates/a.json")
    first["skills"].append("mutated")

    assert store.get("candidates/a.json") == {"skills": ["Python"]}


def test_disabling_the_cache_always_reads_through(container, monkeypatch):
    monkeypatch.setattr(azure_services.settings, "BLOB_CACHE_ENABLED", False)
    store = JsonBlobStore(FakeBlobService(container), prefix="documents")

    store.put("candidates/a.json", {"name": "Ada"})
    store.get("candidates/a.json")
    store.get("candidates/a.json")
    assert container.downloads == 2


def test_listing_cache_is_invalidated_by_our_own_write(container, monkeypatch):
    monkeypatch.setattr(azure_services.settings, "BLOB_CACHE_ENABLED", True)
    monkeypatch.setattr(azure_services.settings, "BLOB_LISTING_CACHE_SECONDS", 60)
    store = JsonBlobStore(FakeBlobService(container), prefix="documents")

    store.put("candidates/a.json", {"name": "Ada"})
    assert store.list_prefix("candidates") == ["candidates/a.json"]

    store.put("candidates/b.json", {"name": "Grace"})
    assert store.list_prefix("candidates") == ["candidates/a.json", "candidates/b.json"]


def test_listing_cache_reuses_a_recent_listing(container, monkeypatch):
    monkeypatch.setattr(azure_services.settings, "BLOB_CACHE_ENABLED", True)
    monkeypatch.setattr(azure_services.settings, "BLOB_LISTING_CACHE_SECONDS", 60)
    store = JsonBlobStore(FakeBlobService(container), prefix="documents")
    store.put("candidates/a.json", {"name": "Ada"})

    store.list_prefix("candidates")
    listings = container.listings
    store.list_prefix("candidates")
    assert container.listings == listings


def test_put_many_strict_propagates_failures(store, container, monkeypatch):
    """Primary domain writes must not be silently lost."""
    def explode(self, key, doc):
        raise RuntimeError("blob write failed")

    monkeypatch.setattr(JsonBlobStore, "put", explode)
    with pytest.raises(RuntimeError):
        store.put_many([("candidates/a.json", {"name": "Ada"})], strict=True)
    # Default stays best-effort for secondary writes.
    store.put_many([("candidates/a.json", {"name": "Ada"})])
