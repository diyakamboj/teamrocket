import copy
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
import math
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

import requests
from requests.adapters import HTTPAdapter
from azure.core.credentials import AzureKeyCredential
from azure.core.pipeline.transport import RequestsTransport
from azure.storage.blob import BlobServiceClient, ContentSettings
from openai import AzureOpenAI

from app.config import settings
from app.utils.error_handlers import AzureServiceError
from app.utils.validators import safe_upload_filename
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _record_ai_event(
    service: str,
    status: str,
    start: float,
    *,
    mock: bool,
    error_message: Optional[str] = None,
) -> None:
    """Records an `ai_call` SRE event. Local import of `sre_events` — that
    module imports `document_store` from this file, so importing it at
    module level here would create a circular import. See
    `app/services/sre_events.py`'s module docstring for the full reasoning.
    Never let this import move to the top of the file."""
    from app.services import sre_events

    sre_events.record_event(
        event_type="ai_call",
        service=service,
        status=status,
        duration_ms=(time.monotonic() - start) * 1000,
        error_message=error_message,
        details={"mock": mock},
    )


def _looks_like_connection_string(value: str) -> bool:
    return "AccountName=" in value and "AccountKey=" in value


def _build_blob_client() -> Optional[BlobServiceClient]:
    """Builds a BlobServiceClient from either supported credential form.

    Accepts a full connection string, or an account name plus an account key
    (the key may be given as AZURE_STORAGE_ACCOUNT_KEY or pasted into
    AZURE_STORAGE_CONNECTION_STRING, which is the common mistake). Returns
    None when nothing usable is configured.
    """
    conn = (settings.AZURE_STORAGE_CONNECTION_STRING or "").strip()
    account = (settings.AZURE_STORAGE_ACCOUNT_NAME or "").strip()
    key = (settings.AZURE_STORAGE_ACCOUNT_KEY or "").strip()

    # Both construction paths take the sized transport. Without it the client
    # falls back to azure-core's 10-connection pool, and the batched reads
    # queue for sockets — which is the whole point of _build_blob_transport.
    if conn and _looks_like_connection_string(conn):
        return BlobServiceClient.from_connection_string(
            conn, transport=_build_blob_transport()
        )

    # A bare key was supplied; pair it with the account name to form a URL.
    if not key and conn:
        key = conn
    if account and key:
        return BlobServiceClient(
            account_url=f"https://{account}.blob.core.windows.net",
            credential=key,
            transport=_build_blob_transport(),
        )

    if key and not account:
        raise ValueError(
            "an account key was supplied without an account name — set "
            "AZURE_STORAGE_ACCOUNT_NAME, or use the full connection string"
        )
    return None

def _build_blob_transport() -> RequestsTransport:
    """HTTP transport sized for the batched reads/writes the store issues.

    azure-core mounts a plain `requests` adapter, whose pool defaults to 10
    connections. Batched operations run `BLOB_MAX_CONCURRENCY` threads, so on
    the stock pool most of them queue for a socket and the overflow pays a
    fresh TLS handshake per call.
    """
    pool = max(settings.BLOB_CONNECTION_POOL_SIZE, settings.BLOB_MAX_CONCURRENCY)
    session = requests.Session()
    adapter = HTTPAdapter(pool_connections=pool, pool_maxsize=pool)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return RequestsTransport(session=session, session_owner=False)


class AzureBlobService:
    def __init__(self) -> None:
        self.container = settings.AZURE_BLOB_CONTAINER_NAME
        self._client: Optional[BlobServiceClient] = None
        self.mock = settings.USE_MOCK_AZURE or not (
            settings.AZURE_STORAGE_CONNECTION_STRING
            or (settings.AZURE_STORAGE_ACCOUNT_NAME and settings.AZURE_STORAGE_ACCOUNT_KEY)
        )
        if not self.mock:
            # This runs at import (module-level singleton), so a malformed
            # connection string used to abort the whole process before the app
            # could serve a single request. Fall back to local-disk storage and
            # say so loudly instead.
            try:
                self._client = _build_blob_client()
                if self._client is None:
                    raise ValueError("no usable Azure Storage credentials configured")
            except Exception as exc:
                logger.error(
                    "Azure Blob Storage not configured correctly (%s) — falling back to local "
                    "disk at %s. Set AZURE_STORAGE_CONNECTION_STRING to the full connection "
                    "string, or set AZURE_STORAGE_ACCOUNT_NAME together with "
                    "AZURE_STORAGE_ACCOUNT_KEY.",
                    exc,
                    settings.UPLOAD_DIR,
                )
                self._client = None
                self.mock = True
            else:
                try:
                    self._client.create_container(self.container)
                except Exception:
                    pass

    def upload_bytes(
        self,
        data: bytes,
        filename: str,
        content_type: str = "application/pdf",
        prefix: str = "resumes",
    ) -> str:
        # The filename is client-supplied and becomes part of the blob key, so
        # it is reduced to a single safe segment before it gets there.
        blob_name = f"{prefix}/{uuid.uuid4()}/{safe_upload_filename(filename)}"
        if self.mock:
            local_dir = Path(settings.UPLOAD_DIR) / "blobs"
            local_dir.mkdir(parents=True, exist_ok=True)
            path = local_dir / blob_name.replace("/", "_")
            path.write_bytes(data)
            logger.info("Mock blob upload: %s", path)
            return str(path)

        assert self._client is not None
        blob = self._client.get_blob_client(container=self.container, blob=blob_name)
        blob.upload_blob(
            data,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type),
        )
        return blob_name

    def delete_blob(self, blob_path: str) -> None:
        """Remove an uploaded file. Deleting the record without this leaves
        the bytes in storage forever, which is not what "delete" should mean
        for a document someone uploaded."""
        if self.mock or Path(blob_path).exists():
            path = Path(blob_path)
            if path.exists():
                path.unlink()
            return

        assert self._client is not None
        try:
            self._client.get_blob_client(
                container=self.container, blob=blob_path
            ).delete_blob()
        except Exception as exc:
            logger.warning("Blob delete failed for %s: %s", blob_path, exc)

    def download_bytes(self, blob_path: str) -> bytes:
        if self.mock or Path(blob_path).exists():
            path = Path(blob_path)
            if not path.exists():
                raise AzureServiceError("Blob not found locally", {"path": blob_path})
            return path.read_bytes()

        assert self._client is not None
        blob = self._client.get_blob_client(container=self.container, blob=blob_path)
        return blob.download_blob().readall()


_BLOB_POOL: Optional[ThreadPoolExecutor] = None
_BLOB_POOL_LOCK = threading.Lock()


def _blob_pool() -> ThreadPoolExecutor:
    """One process-wide worker pool for batched blob I/O, so a batch does not
    create (and tear down) a thread pool per call."""
    global _BLOB_POOL
    if _BLOB_POOL is None:
        with _BLOB_POOL_LOCK:
            if _BLOB_POOL is None:
                _BLOB_POOL = ThreadPoolExecutor(
                    max_workers=max(1, settings.BLOB_MAX_CONCURRENCY),
                    thread_name_prefix="blob",
                )
    return _BLOB_POOL


class _DocumentCache:
    """ETag-validated cache of JSON documents.

    Blob Storage returns an ETag for every blob in a *listing*, and listing
    200 blobs costs one round-trip where reading them costs 200. So a
    collection read lists first and then downloads only the blobs whose ETag
    differs from the cached copy — re-reading unchanged data becomes a single
    LIST.

    Coherence: a cached document is served only while the ETag from the most
    recent listing (or from our own write) still matches, so another writer's
    change is picked up by the next listing. Documents in append-only
    collections are never rewritten, so those are cached without
    revalidation (`immutable=True` on `list_prefix`). `BLOB_CACHE_ENABLED`
    turns the whole thing off.
    """

    #: Sentinel ETag for blobs in append-only collections, which by contract
    #: are written once and never modified.
    IMMUTABLE = "\x00immutable"

    def __init__(self, *, enabled: bool, listing_ttl: float, max_documents: int = 50_000) -> None:
        self.enabled = enabled
        self._listing_ttl = listing_ttl
        self._max_documents = max_documents
        self._docs: dict[str, tuple[str, dict]] = {}
        self._etags: dict[str, str] = {}
        self._listings: dict[str, tuple[float, list[str]]] = {}
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    @staticmethod
    def _normalize(etag: Optional[str]) -> Optional[str]:
        # Listings and upload responses quote ETags inconsistently.
        return etag.strip('"') if etag else None

    def fresh_doc(self, key: str) -> Optional[dict]:
        """Cached document if its ETag still matches what the server last
        reported, else None. Returns a copy — callers must not share state."""
        if not self.enabled:
            return None
        with self._lock:
            cached = self._docs.get(key)
            expected = self._etags.get(key)
            if cached is not None and expected is not None and cached[0] == expected:
                self.hits += 1
                return copy.deepcopy(cached[1])
            self.misses += 1
            return None

    def store_doc(self, key: str, etag: Optional[str], doc: dict) -> None:
        etag = self._normalize(etag)
        if not self.enabled or etag is None:
            return
        with self._lock:
            if len(self._docs) >= self._max_documents:
                self._docs.clear()
            self._docs[key] = (etag, copy.deepcopy(doc))
            self._etags[key] = etag

    def note_etag(self, key: str, etag: Optional[str]) -> None:
        etag = self._normalize(etag)
        if not self.enabled or etag is None:
            return
        with self._lock:
            if len(self._etags) >= self._max_documents:
                self._etags.clear()
                self._docs.clear()
            self._etags[key] = etag

    def note_immutable(self, keys: list[str]) -> None:
        """Mark keys as write-once, so cached copies never need revalidating."""
        if not self.enabled:
            return
        with self._lock:
            if len(self._etags) + len(keys) >= self._max_documents:
                self._etags.clear()
                self._docs.clear()
            for key in keys:
                self._etags.setdefault(key, self.IMMUTABLE)

    def forget(self, key: str) -> None:
        if not self.enabled:
            return
        with self._lock:
            self._docs.pop(key, None)
            self._etags.pop(key, None)

    def listing(self, prefix: str) -> Optional[list[str]]:
        if not self.enabled or self._listing_ttl <= 0:
            return None
        with self._lock:
            entry = self._listings.get(prefix)
            if entry and (time.monotonic() - entry[0]) < self._listing_ttl:
                return list(entry[1])
            return None

    def store_listing(self, prefix: str, keys: list[str]) -> None:
        if not self.enabled or self._listing_ttl <= 0:
            return
        with self._lock:
            self._listings[prefix] = (time.monotonic(), list(keys))

    def invalidate_listings_for(self, key: str) -> None:
        """Drop any cached listing that covered `key`, so our own write is
        visible to the next read immediately."""
        if not self.enabled:
            return
        with self._lock:
            for prefix in [p for p in self._listings if key.startswith(p)]:
                self._listings.pop(prefix, None)
            self._listings.pop("", None)

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "enabled": self.enabled,
                "documents": len(self._docs),
                "hits": self.hits,
                "misses": self.misses,
            }


class JsonBlobStore:
    """Generic JSON-document store layered on top of AzureBlobService.

    This is the persistence primitive that replaces the SQLAlchemy/SQLite
    layer: every structured entity in the app (candidates, jobs,
    evaluations, evidence, audit logs, ...) is written as one JSON document
    per blob key, under a shared `documents/` prefix in the same blob
    container used for raw resume bytes.

    Mock mode (USE_MOCK_AZURE) writes real nested directories under
    `UPLOAD_DIR/documents/...` so prefix listing works via `Path.rglob`.
    Real mode uses the Azure Blob Storage container directly, listing blobs
    by name prefix.
    """

    MAX_FETCH_WORKERS = 32

    def __init__(self, blob_service: AzureBlobService, prefix: str = "documents") -> None:
        self._blob_service = blob_service
        self.prefix = prefix.strip("/")
        # Local mock mode reads straight off disk, where caching would only
        # add copying overhead and a second source of truth.
        self._cache = _DocumentCache(
            enabled=settings.BLOB_CACHE_ENABLED and not blob_service.mock,
            listing_ttl=settings.BLOB_LISTING_CACHE_SECONDS,
        )

    @property
    def cache(self) -> _DocumentCache:
        return self._cache

    def _blob_client(self, key: str):
        client = self._blob_service._client
        assert client is not None
        return client.get_blob_client(
            container=self._blob_service.container, blob=self._blob_name(key)
        )

    def _map(self, fn, items: list) -> list:
        """Run `fn` over `items` on the shared pool, preserving order."""
        workers = min(max(1, settings.BLOB_MAX_CONCURRENCY), len(items))
        if workers <= 1:
            return [fn(item) for item in items]
        return list(_blob_pool().map(fn, items))

    def _local_root(self) -> Path:
        root = Path(settings.UPLOAD_DIR) / self.prefix
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _local_path(self, key: str) -> Path:
        return self._local_root() / key

    def _blob_name(self, key: str) -> str:
        return f"{self.prefix}/{key}"

    def put(self, key: str, doc: dict) -> None:
        data = json.dumps(doc, default=str).encode("utf-8")
        if self._blob_service.mock:
            path = self._local_path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            return

        result = self._blob_client(key).upload_blob(
            data,
            overwrite=True,
            content_settings=ContentSettings(content_type="application/json"),
        )
        # The write response carries the new ETag, so what we just wrote is
        # readable from cache without a round-trip.
        self._cache.store_doc(key, (result or {}).get("etag"), doc)
        self._cache.invalidate_listings_for(key)

    def get(self, key: str) -> Optional[dict]:
        if self._blob_service.mock:
            path = self._local_path(key)
            if not path.exists():
                return None
            return json.loads(path.read_text(encoding="utf-8"))

        cached = self._cache.fresh_doc(key)
        if cached is not None:
            return cached
        return self._fetch(key)

    def _fetch(self, key: str) -> Optional[dict]:
        """Download and cache one document, skipping the cache lookup."""
        try:
            downloader = self._blob_client(key).download_blob()
            data = downloader.readall()
        except Exception:
            return None
        doc = json.loads(data.decode("utf-8"))
        properties = getattr(downloader, "properties", None)
        self._cache.store_doc(key, getattr(properties, "etag", None), doc)
        return doc

    def get_many(self, keys: list[str]) -> list[Optional[dict]]:
        """Fetch many documents concurrently, preserving input order.

        Against real Blob Storage every read is a ~40ms round-trip, so reading
        a collection one key at a time is what made listing endpoints slow.
        Documents whose ETag has not changed since the last listing come from
        cache, so only genuinely changed blobs are downloaded.
        """
        if not keys:
            return []
        if self._blob_service.mock:
            return [self.get(key) for key in keys]

        results: list[Optional[dict]] = [None] * len(keys)
        pending: list[int] = []
        for i, key in enumerate(keys):
            cached = self._cache.fresh_doc(key)
            if cached is not None:
                results[i] = cached
            else:
                pending.append(i)
        if not pending:
            return results

        def fetch(index: int) -> tuple[int, Optional[dict]]:
            try:
                return index, self._fetch(keys[index])
            except Exception as exc:
                logger.warning("Failed to read blob %s: %s", keys[index], exc)
                return index, None

        for index, doc in self._map(fetch, pending):
            results[index] = doc
        return results

    def put_many(self, items: list[tuple[str, dict]], *, strict: bool = False) -> None:
        """Write many documents concurrently.

        `strict=True` propagates the first failure, for primary domain writes
        that must not be silently lost; the default logs and continues, which
        is what secondary writes (evidence, history) want.
        """
        if not items:
            return
        if self._blob_service.mock:
            for key, doc in items:
                self.put(key, doc)
            return

        def write(item: tuple[str, dict]) -> None:
            key, doc = item
            try:
                self.put(key, doc)
            except Exception as exc:
                if strict:
                    raise
                logger.warning("Failed to write blob %s: %s", key, exc)

        self._map(write, items)


    def delete(self, key: str) -> None:
        if self._blob_service.mock:
            path = self._local_path(key)
            if path.exists():
                path.unlink()
            return

        try:
            self._blob_client(key).delete_blob()
        except Exception:
            pass
        self._cache.forget(key)
        self._cache.invalidate_listings_for(key)

    def delete_many(self, keys: list[str]) -> None:
        """Delete many documents concurrently (see `get_many` for why)."""
        if not keys:
            return
        if self._blob_service.mock:
            for key in keys:
                self.delete(key)
            return
        self._map(self.delete, keys)



    def exists(self, key: str) -> bool:
        if self._blob_service.mock:
            return self._local_path(key).exists()

        if self._cache.fresh_doc(key) is not None:
            return True
        return bool(self._blob_client(key).exists())

    def list_prefix(self, prefix: str, *, immutable: bool = False) -> list[str]:
        """List document keys (relative to `documents/`) under `prefix`, sorted ascending.

        `immutable=True` promises the caller only ever writes a key once
        (append-only collections), which lets the listing skip fetching ETags
        and lets cached documents be reused without revalidation.
        """
        prefix = prefix.strip("/")
        if self._blob_service.mock:
            root = self._local_root()
            base = root / prefix if prefix else root
            if not base.exists():
                return []
            keys = [
                str(path.relative_to(root))
                for path in base.rglob("*.json")
                if path.is_file()
            ]
            return sorted(keys)

        cached_listing = self._cache.listing(prefix)
        if cached_listing is not None:
            return cached_listing

        client = self._blob_service._client
        assert client is not None
        container_client = client.get_container_client(self._blob_service.container)
        full_prefix = f"{self.prefix}/{prefix}" if prefix else f"{self.prefix}/"
        strip = len(self.prefix) + 1

        if immutable:
            keys = [
                name[strip:]
                for name in container_client.list_blob_names(name_starts_with=full_prefix)
            ]
            self._cache.note_immutable(keys)
        else:
            keys = []
            for blob in container_client.list_blobs(name_starts_with=full_prefix):
                key = blob.name[strip:]
                keys.append(key)
                self._cache.note_etag(key, blob.etag)

        keys.sort()
        self._cache.store_listing(prefix, keys)
        return keys


class AzureOpenAIService:
    def __init__(self) -> None:
        configured = bool(settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_ENDPOINT)
        self._client: Optional[AzureOpenAI] = None
        self._embedding_client: Optional[AzureOpenAI] = None

        if configured:
            self._client = AzureOpenAI(
                api_key=settings.AZURE_OPENAI_API_KEY,
                api_version=settings.AZURE_OPENAI_API_VERSION,
                azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
                timeout=settings.AZURE_OPENAI_TIMEOUT_SECONDS,
                max_retries=settings.AZURE_OPENAI_MAX_RETRIES,
            )

        emb_configured = bool(settings.AZURE_OPENAI_EMBEDDING_API_KEY and settings.AZURE_OPENAI_EMBEDDING_ENDPOINT)
        if emb_configured:
            self._embedding_client = AzureOpenAI(
                api_key=settings.AZURE_OPENAI_EMBEDDING_API_KEY,
                api_version=settings.AZURE_OPENAI_API_VERSION,
                azure_endpoint=settings.AZURE_OPENAI_EMBEDDING_ENDPOINT,
                timeout=settings.AZURE_OPENAI_TIMEOUT_SECONDS,
                max_retries=settings.AZURE_OPENAI_MAX_RETRIES,
            )
        else:
            self._embedding_client = self._client

        self.mock = settings.USE_MOCK_AZURE or not configured
        self.embeddings_mock = (
            (not configured and not emb_configured) or not settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME
        )
        self._embedding_cache: dict[str, list[float]] = {}

        # Circuit breaker. Scoring loops call this service once per candidate,
        # so a misconfigured or down endpoint otherwise multiplies its failure
        # latency by the pool size — 200 candidates x retry backoff turned the
        # ranking endpoint into a >10 minute hang. After
        # OPENAI_FAILURE_THRESHOLD consecutive failures the breaker opens and
        # calls fail instantly (falling straight through to the deterministic
        # path) until OPENAI_BREAKER_COOLDOWN_SECONDS has passed, then one
        # request is allowed through to test recovery.
        self._consecutive_failures = 0
        self._breaker_opened_at: float | None = None


    def chat_json(
        self,
        prompt: str,
        *,
        system: str = "You are a helpful recruiting assistant. Return valid JSON only.",
        temperature: float = 0.3,
        deployment: Optional[str] = None,
        max_tokens: int = 1200,
    ) -> dict[str, Any]:
        """`max_tokens` matters more than it looks on reasoning deployments.

        On gpt-5 the budget covers reasoning *and* output, so a request that
        needs a long JSON answer can spend the whole allowance thinking and
        return an empty string — which reads downstream as "the model failed"
        rather than "the answer did not fit". Callers asking for bulky JSON
        should raise this.
        """
        content = self.chat_text(
            prompt,
            system=system,
            temperature=temperature,
            deployment=deployment,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        return self._safe_json(content)

    def chat_json_or_empty(
        self,
        prompt: str,
        *,
        system: str = "You are a helpful recruiting assistant. Return valid JSON only.",
        temperature: float = 0.3,
        deployment: Optional[str] = None,
        max_tokens: int = 1200,
    ) -> dict[str, Any]:
        """`chat_json`, but returns {} instead of raising when Azure is
        unreachable or errors.

        Every caller of this already treats a missing key as "fall back to the
        deterministic result" (keyword scoring, heuristic JD parsing, and so
        on). Letting the exception escape instead turns a transient Azure
        outage into a 500 on core screening endpoints, which is exactly the
        graceful-degradation guarantee the AI seams are supposed to keep. The
        failure is logged rather than swallowed silently.
        """
        try:
            return self.chat_json(
                prompt,
                system=system,
                temperature=temperature,
                deployment=deployment,
                max_tokens=max_tokens,
            )
        except AzureServiceError as exc:
            logger.warning(
                "Azure OpenAI unavailable, falling back to deterministic logic: %s", exc
            )
            return {}

    def chat_text(
        self,
        prompt: str,
        *,
        system: str = "You are a helpful recruiting assistant.",
        temperature: float = 0.5,
        max_tokens: int = 1200,
        messages: Optional[list[dict[str, str]]] = None,
        deployment: Optional[str] = None,
        response_format: Optional[dict[str, str]] = None,
    ) -> str:
        start = time.monotonic()
        if self.mock:
            _record_ai_event("azure_openai_chat", "success", start, mock=True)
            return self._mock_response(prompt)

        if self._breaker_is_open():
            _record_ai_event("azure_openai_chat", "fallback", start, mock=False)
            raise AzureServiceError(
                "Azure OpenAI unavailable (circuit breaker open)",
                {"consecutive_failures": self._consecutive_failures},
            )

        assert self._client is not None
        payload = messages or [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ]
        selected_deployment = deployment or settings.AZURE_OPENAI_DEPLOYMENT_NAME
        is_gpt5 = selected_deployment.lower().startswith("gpt-5")
        effort = (settings.AZURE_OPENAI_REASONING_EFFORT or "").strip().lower()
        completion_options = {
            **({"max_completion_tokens": max(max_tokens, 3000)} if is_gpt5 else {"max_tokens": max_tokens}),
            **({} if is_gpt5 else {"temperature": temperature}),
            # Reasoning effort is only meaningful to reasoning deployments;
            # sending it to gpt-4o-class models is an API error.
            **({"reasoning_effort": effort} if is_gpt5 and effort else {}),
            **({"response_format": response_format} if response_format else {}),
        }
        try:
            response = self._client.chat.completions.create(
                model=selected_deployment,
                messages=payload,
                **completion_options,
            )
        except Exception as exc:
            self._record_failure()
            _record_ai_event("azure_openai_chat", "failure", start, mock=False, error_message=str(exc))
            logger.warning("Azure OpenAI call failed: %s", exc)
            raise AzureServiceError("Azure OpenAI request failed", {"reason": str(exc)}) from exc

        self._record_success()
        _record_ai_event("azure_openai_chat", "success", start, mock=False)
        return response.choices[0].message.content or ""

    # ---------- circuit breaker ----------

    def _breaker_is_open(self) -> bool:
        if self._breaker_opened_at is None:
            return False
        elapsed = time.monotonic() - self._breaker_opened_at
        if elapsed < settings.AZURE_OPENAI_BREAKER_COOLDOWN_SECONDS:
            return True
        # Cooldown elapsed — let one request through to probe for recovery.
        self._breaker_opened_at = None
        self._consecutive_failures = settings.AZURE_OPENAI_FAILURE_THRESHOLD - 1
        return False

    @property
    def breaker_state(self) -> dict[str, Any]:
        """Side-effect-free breaker snapshot for the Ops dashboard.

        Deliberately does NOT call `_breaker_is_open()` — that method
        mutates state (clears `_breaker_opened_at` and pre-seeds
        `_consecutive_failures` once the cooldown elapses, to let exactly
        one recovery-probe request through). A dashboard polling this every
        few seconds would otherwise silently consume that probe as a side
        effect of a page load.
        """
        is_open = self._breaker_opened_at is not None and (
            time.monotonic() - self._breaker_opened_at
        ) < settings.AZURE_OPENAI_BREAKER_COOLDOWN_SECONDS
        return {
            "is_open": is_open,
            "consecutive_failures": self._consecutive_failures,
            "mock": self.mock,
        }

    def _record_failure(self) -> None:
        self._consecutive_failures += 1
        if (
            self._consecutive_failures >= settings.AZURE_OPENAI_FAILURE_THRESHOLD
            and self._breaker_opened_at is None
        ):
            self._breaker_opened_at = time.monotonic()
            logger.error(
                "Azure OpenAI failed %d times in a row — skipping calls for %.0fs and using "
                "deterministic fallbacks. Check AZURE_OPENAI_ENDPOINT / credentials.",
                self._consecutive_failures,
                settings.AZURE_OPENAI_BREAKER_COOLDOWN_SECONDS,
            )

    def _record_success(self) -> None:
        if self._breaker_opened_at is not None or self._consecutive_failures:
            logger.info("Azure OpenAI recovered")
        self._consecutive_failures = 0
        self._breaker_opened_at = None

    def embed_texts(self, texts: list[str]) -> Optional[list[list[float]]]:
        """Real embeddings for genuine semantic similarity. Returns None (the
        caller falls back to a keyword heuristic) in mock mode, when no
        embedding deployment is configured, or on any API failure — this is
        a quality upgrade, not something that should ever break scoring."""
        if self.embeddings_mock or not texts or self._embedding_client is None:
            return None

        to_fetch = [t for t in dict.fromkeys(texts) if t not in self._embedding_cache]
        if to_fetch:
            # Embeddings share the endpoint, so they share the breaker — one
            # unreachable resource shouldn't be re-dialled once per candidate.
            if self._breaker_is_open():
                return None
            start = time.monotonic()
            try:
                response = self._embedding_client.embeddings.create(
                    model=settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME,
                    input=to_fetch,
                )

                for text, item in zip(to_fetch, response.data):
                    self._embedding_cache[text] = item.embedding
            except Exception as exc:
                self._record_failure()
                _record_ai_event(
                    "azure_openai_embeddings", "failure", start, mock=False, error_message=str(exc)
                )
                logger.warning(
                    "Embedding request failed, falling back to keyword overlap: %s", exc
                )
                return None
            self._record_success()
            _record_ai_event("azure_openai_embeddings", "success", start, mock=False)
        return [self._embedding_cache[t] for t in texts]

    def _safe_json(self, content: str) -> dict[str, Any]:
        content = content.strip()
        if content.startswith("```"):
            content = content.strip("`")
            if content.startswith("json"):
                content = content[4:].strip()
        try:
            data = json.loads(content)
            if isinstance(data, dict):
                return data
            return {"data": data}
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                try:
                    return json.loads(content[start : end + 1])
                except json.JSONDecodeError:
                    pass
            logger.warning("Failed to parse JSON from model response")
            return {"raw": content}

    @staticmethod
    def _mock_evaluation_narrative(prompt: str) -> dict[str, Any]:
        """Offline stand-in for the evaluation-narrative LLM call.

        Deliberately omits `matched_skills`/`missing_skills` so
        CandidateMatcher's deterministic fallback derives them from this
        candidate's actual skills against this job's actual requirements —
        a fixed skill list here would be wrong for every candidate. The
        narrative is phrased off the real per-dimension scores parsed back
        out of the prompt, so it tracks the candidate being scored.
        """
        scores: dict[str, float] = {}
        for line in prompt.splitlines():
            line = line.strip()
            if not line.startswith("- ") or ":" not in line or "/100" not in line:
                continue
            label, _, value = line[2:].partition(":")
            try:
                scores[label.strip()] = float(value.strip().split("/")[0])
            except ValueError:
                continue

        def band(name: str) -> str:
            value = scores.get(name)
            if value is None:
                return "not evaluated"
            if value >= 80:
                return "strong"
            if value >= 60:
                return "solid"
            if value >= 40:
                return "partial"
            return "limited"

        strong = [name for name, value in scores.items() if value >= 70]
        weak = [name for name, value in scores.items() if value < 50]

        return {
            "strengths": (
                "Strongest evidence in " + ", ".join(strong).lower() + "."
                if strong
                else "No dimension scored above the strong-evidence threshold."
            ),
            # Empty rather than a "nothing found" sentence: callers render this
            # as a gap list, where a reassuring sentence would read as a gap.
            "weaknesses": ("Thin evidence for " + ", ".join(weak).lower() + "." if weak else ""),
            "transferable_skills": (
                f"Skill match is {band('Skill Match')} and role alignment is "
                f"{band('Role Alignment')}; adjacent experience should be probed in interview."
            ),
            "technical_skills_explanation": f"Technical skill evidence is {band('Technical Skills')}.",
            "communication_explanation": f"Communication evidence is {band('Communication')}.",
            "role_alignment_explanation": f"Role alignment is {band('Role Alignment')}.",
            "overall_fit_explanation": f"Overall fit is {band('Overall Fit')} against this job's requirements.",
            "dimensions": {
                "technical_skills_explanation": f"Technical skill evidence is {band('Technical Skills')}.",
                "communication_explanation": f"Communication evidence is {band('Communication')}.",
                "role_alignment_explanation": f"Role alignment is {band('Role Alignment')}.",
                "overall_fit_explanation": f"Overall fit is {band('Overall Fit')}.",
            },
        }

    def _mock_response(self, prompt: str) -> str:
        lower = prompt.lower()
        if "parse this resume" in lower:
            digest = hashlib.md5(prompt.encode()).hexdigest()[:6]
            return json.dumps(
                {
                    "contact_info": {
                        "name": f"Candidate {digest.upper()}",
                        "email": f"candidate.{digest}@example.com",
                        "phone": "+1-555-0100",
                    },
                    "skills": ["Python", "SQL", "Azure", "Docker", "FastAPI"],
                    "work_experience": [
                        {
                            "company": "Northwind Labs",
                            "title": "Software Engineer",
                            "duration": "2021-2024",
                            "years": 3,
                            "description": "Built APIs and data pipelines using Python and Azure.",
                        }
                    ],
                    "education": [
                        {
                            "school": "State University",
                            "degree": "BSc",
                            "field": "Computer Science",
                        }
                    ],
                    "certifications": ["AZ-900"],
                    "projects": [
                        {
                            "name": "Resume Matcher",
                            "description": "AI ranking prototype",
                            "technologies": ["Python", "FastAPI"],
                        }
                    ],
                }
            )
        if "extract" in lower and "job" in lower:
            return json.dumps(
                {
                    "required_skills": ["Python", "SQL", "Azure", "Docker"],
                    "nice_to_have_skills": ["Kubernetes", "Terraform"],
                    "required_experience_years": 3,
                    "education_requirements": "Bachelor's in Computer Science or equivalent",
                    "summary": "Backend-focused role requiring cloud and API experience.",
                }
            )
        if "generate" in lower and (
            "matched skills" in lower or "matched_skills" in lower or "format as json" in lower
        ):
            return json.dumps(self._mock_evaluation_narrative(prompt))
        if "proper ats score" in lower or "semantic fit review" in lower:
            return json.dumps(
                {
                    "ats_score": 78,
                    "semantic_score": 78,
                    "category_scores": {
                        "skills": 82,
                        "experience": 74,
                        "education": 80,
                        "certifications": 60,
                        "projects": 76,
                    },
                    "tier": "good",
                    "rationale": (
                        "Resume shows hands-on delivery in the required stack with production "
                        "ownership; some required keywords appear as adjacent tools rather than "
                        "exact terms, which a literal keyword scan would miss."
                    ),
                    "equivalent_terms": [
                        {"resume_term": "FastAPI", "jd_keyword": "Python"},
                        {"resume_term": "Azure Blob Storage", "jd_keyword": "Azure"},
                    ],
                }
            )
        if "compare these" in lower:
            return (
                "Candidate A shows stronger cloud depth; Candidate B has broader product experience. "
                "Recommend interviewing A first for backend cloud roles."
            )
        return (
            "Based on the ranked candidate pool, prioritize candidates with strong Python and Azure "
            "evidence, then validate production ownership in interviews."
        )


class AzureDocumentIntelligenceService:
    def __init__(self) -> None:
        self.mock = (
            settings.USE_MOCK_AZURE
            or not settings.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
            or not settings.AZURE_DOCUMENT_INTELLIGENCE_KEY
        )
        self._client = None
        if not self.mock:
            try:
                from azure.ai.documentintelligence import DocumentIntelligenceClient

                self._client = DocumentIntelligenceClient(
                    endpoint=settings.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
                    credential=AzureKeyCredential(settings.AZURE_DOCUMENT_INTELLIGENCE_KEY),
                )
            except Exception as exc:
                logger.error(
                    "Azure Document Intelligence unavailable (%s) — falling back to local "
                    "PDF text extraction.",
                    exc,
                )
                self._client = None
                self.mock = True

    def _extract_pdf_or_docx_fallback(self, file_bytes: bytes, filename: str) -> str:
        ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
        if ext == "pdf":
            try:
                import io
                from pypdf import PdfReader
                reader = PdfReader(io.BytesIO(file_bytes))
                text_parts = [page.extract_text() for page in reader.pages if page.extract_text()]
                if text_parts:
                    return "\n".join(text_parts)
            except Exception:
                pass
            try:
                text = file_bytes.decode("latin1", errors="ignore")
                matches = re.findall(r"\(([^()]{3,})\)", text)
                if len(matches) > 5:
                    return "\n".join(matches)
            except Exception:
                pass
        return ""

    #: Formats that are already text. Sending these to Document Intelligence
    #: fails — `prebuilt-read` expects PDFs or images — and it would be a
    #: pointless round-trip even if it worked.
    PLAIN_TEXT_SUFFIXES = (".txt", ".md")

    def extract_text(self, file_bytes: bytes, filename: str = "resume.pdf") -> str:
        if filename.lower().endswith(self.PLAIN_TEXT_SUFFIXES):
            return file_bytes.decode("utf-8", errors="ignore")

        start = time.monotonic()
        if self.mock:
            _record_ai_event("document_intelligence", "success", start, mock=True)
            extracted = self._extract_pdf_or_docx_fallback(file_bytes, filename)
            if extracted and len(extracted.strip()) > 30:
                return extracted
            clean_name = filename.replace("_", " ").replace("-", " ").rsplit(".", 1)[0].title()
            clean_email = re.sub(r"[^a-zA-Z0-9]", "", filename.lower().rsplit(".", 1)[0]) or "candidate"
            return (
                f"{clean_name}\nSoftware Engineer\nemail: {clean_email}@example.com\n"
                "Skills: Python, React, Azure, Docker, FastAPI, Kubernetes\n"
                "Experience: Senior Software Engineer with 5 years experience building cloud services.\n"
                "Education: Bachelor of Science in Computer Science\n"
                "Projects: Distributed systems and microservices platform"
            )

        assert self._client is not None

        try:
            poller = self._client.begin_analyze_document(
                "prebuilt-read",
                body=file_bytes,
                content_type="application/octet-stream",
            )
            result = poller.result()
            if result.content:
                _record_ai_event("document_intelligence", "success", start, mock=False)
                return result.content
        except Exception as exc:
            _record_ai_event("document_intelligence", "failure", start, mock=False, error_message=str(exc))
            logger.warning("Document Intelligence failed for %s: %s", filename, exc)

        # Local extraction as a fallback: a readable PDF or Word file should
        # not be unreadable just because the OCR service rejected it.
        extracted = self._extract_pdf_or_docx_fallback(file_bytes, filename)
        if extracted and extracted.strip():
            return extracted
        raise AzureServiceError(
            "Could not extract text from the document",
            {"filename": filename},
        )


class AzureSearchService:
    def __init__(self) -> None:
        # Deliberately independent of USE_MOCK_AZURE: Search has its own
        # dedicated credentials and can go live without touching the mock
        # status of OpenAI/Blob/Document Intelligence, which may not have a
        # working deployment yet.
        self.mock = not settings.AZURE_SEARCH_ENDPOINT or not settings.AZURE_SEARCH_ADMIN_KEY
        self._client = None
        if not self.mock:
            try:
                from azure.search.documents import SearchClient

                self._client = SearchClient(
                    endpoint=settings.AZURE_SEARCH_ENDPOINT,
                    index_name=settings.AZURE_SEARCH_INDEX_NAME,
                    credential=AzureKeyCredential(settings.AZURE_SEARCH_ADMIN_KEY),
                )
            except Exception as exc:
                logger.error(
                    "Azure AI Search unavailable (%s) — falling back to keyword overlap.", exc
                )
                self._client = None
                self.mock = True

    def semantic_skill_overlap(self, candidate_skills: list[str], required_skills: list[str]) -> float:
        """Real embedding-based semantic overlap when an embedding deployment
        is configured; falls back to literal keyword overlap otherwise (mock
        mode, no deployment, or an API failure)."""
        if not required_skills:
            return 100.0
        if not candidate_skills:
            return 0.0

        embedded = self._embedding_overlap(candidate_skills, required_skills)
        if embedded is not None:
            return embedded

        cand = {s.lower() for s in candidate_skills}
        req = {s.lower() for s in required_skills}
        overlap = len(cand & req)
        return round((overlap / len(req)) * 100, 2)

    def _embedding_overlap(
        self, candidate_skills: list[str], required_skills: list[str]
    ) -> Optional[float]:
        vectors = openai_service.embed_texts([*candidate_skills, *required_skills])
        if not vectors:
            return None
        cand_vecs = vectors[: len(candidate_skills)]
        req_vecs = vectors[len(candidate_skills) :]
        if not cand_vecs or not req_vecs:
            return None

        # For each required skill, take the candidate's best-matching skill
        # by cosine similarity; overall score is the mean of those best
        # matches, rescaled from an empirically-observed band rather than
        # the full [-1, 1] range. text-embedding-3-small cosine similarity
        # for short skill phrases (measured against this deployment):
        # unrelated pairs (e.g. "Python"/"bricklaying") land ~0.11-0.14,
        # genuinely related-but-different skills (e.g. "Node.js"/
        # "JavaScript", "AWS"/"Azure") land ~0.50-0.71, identical = 1.0.
        best_matches = [
            max(self._cosine(req_vec, cand_vec) for cand_vec in cand_vecs) for req_vec in req_vecs
        ]
        mean_best = sum(best_matches) / len(best_matches)
        floor, ceiling = 0.15, 0.65
        return round(max(0.0, min(100.0, (mean_best - floor) / (ceiling - floor) * 100)), 2)

    @staticmethod
    def _cosine(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(y * y for y in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    def upsert_candidate(self, candidate: dict[str, Any]) -> None:
        if self.mock or not self._client:
            return
        try:
            self._client.upload_documents(documents=[{**candidate, "@search.action": "mergeOrUpload"}])
        except Exception as exc:
            logger.warning("Azure Search upsert failed: %s", exc)

    def delete_candidate(self, record_id: str) -> None:
        if self.mock or not self._client:
            return
        try:
            self._client.delete_documents(documents=[{"id": str(record_id)}])
        except Exception as exc:
            logger.warning("Azure Search delete failed for %s: %s", record_id, exc)

    def upsert_candidates(self, candidates: list[dict[str, Any]]) -> int:
        """Upload many documents at once. Returns how many were accepted."""
        if self.mock or not self._client or not candidates:
            return 0
        accepted = 0
        # The service caps a batch by size, not just count; 100 documents of
        # a 1536-float vector each stays well inside it.
        for start in range(0, len(candidates), 100):
            chunk = candidates[start : start + 100]
            try:
                results = self._client.upload_documents(
                    documents=[{**c, "@search.action": "mergeOrUpload"} for c in chunk]
                )
                accepted += sum(1 for r in results if getattr(r, "succeeded", False))
            except Exception as exc:
                logger.warning("Azure Search bulk upsert failed: %s", exc)
        return accepted

    def list_document_ids(self, *, limit: int = 5000) -> Optional[set[str]]:
        """Every document id in the index, or None if it could not be read."""
        if self.mock or not self._client:
            return None
        try:
            found: set[str] = set()
            results = self._client.search(search_text="*", select=["id"], top=limit)
            for hit in results:
                doc_id = hit.get("id")
                if doc_id:
                    found.add(str(doc_id))
            return found
        except Exception as exc:
            logger.warning("Could not list Azure Search document ids: %s", exc)
            return None

    def lexical_search(
        self,
        query_text: str,
        *,
        limit: int = 10,
        filter_expression: Optional[str] = None,
    ) -> Optional[list[dict[str, Any]]]:
        """Keyword (BM25) search, no vector involved.

        The lexical half of a fused query. Used when Qdrant owns the vector
        side: this contributes the exact-term matching that embeddings are
        weakest at -- a candidate's name, a specific tool, a certification
        number.

        Returns None when the service could not be reached, so the caller can
        fuse with whatever it did get rather than treating an outage as "no
        keyword matches".
        """
        if self.mock or not self._client:
            return None
        try:
            results = self._client.search(
                search_text=query_text,
                filter=filter_expression,
                top=limit,
            )
            return [dict(hit) for hit in results]
        except Exception as exc:
            logger.warning("Azure Search lexical query failed: %s", exc)
            return None

    def vector_search(
        self,
        vector: list[float],
        *,
        limit: int = 10,
        filter_expression: Optional[str] = None,
        vector_field: str = "contentVector",
        search_text: Optional[str] = None,
    ) -> Optional[list[dict[str, Any]]]:
        """Approximate nearest neighbours from the search index.

        Passing `search_text` makes this a *hybrid* query: the index runs the
        vector search and a normal lexical search and fuses the two rankings.
        That is what makes an exact term ("Kubernetes") or a candidate's name
        rank properly -- pure vector similarity is poor at short literal
        queries, which is most of what a search box receives.

        Note the scores differ between the two modes: a pure vector query
        scores by the distance metric, while a fused query returns an RRF
        score on a completely different scale. Callers must not mix them.

        Returns None (rather than an empty list) when the service is
        unavailable, so the caller can tell "no matches" apart from "could not
        ask" and fall back to the local index instead of showing an empty
        result as if it were an answer.
        """
        if self.mock or not self._client:
            return None
        try:
            from azure.search.documents.models import VectorizedQuery

            query = VectorizedQuery(
                vector=vector, k_nearest_neighbors=limit, fields=vector_field
            )
            results = self._client.search(
                search_text=search_text,
                vector_queries=[query],
                filter=filter_expression,
                top=limit,
            )
            return [dict(hit) for hit in results]
        except Exception as exc:
            logger.warning("Azure Search vector query failed: %s", exc)
            return None


blob_service = AzureBlobService()
openai_service = AzureOpenAIService()
doc_intelligence_service = AzureDocumentIntelligenceService()
search_service = AzureSearchService()
document_store = JsonBlobStore(blob_service)
