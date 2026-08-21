from functools import lru_cache
from typing import List, Optional, Union

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # Azure Blob Storage
    # Either supply the full connection string, or the account name plus a key
    # (AZURE_STORAGE_ACCOUNT_KEY, or the account key in
    # AZURE_STORAGE_CONNECTION_STRING). The portal's "Access keys" blade shows
    # both forms; people routinely paste the bare key, which is not usable on
    # its own because it carries no account name.
    AZURE_STORAGE_CONNECTION_STRING: Optional[str] = None
    AZURE_STORAGE_ACCOUNT_NAME: Optional[str] = None
    AZURE_STORAGE_ACCOUNT_KEY: Optional[str] = None
    AZURE_BLOB_CONTAINER_NAME: str = "resumes"

    # Blob-store performance. The document store is this app's database, so
    # its round-trip count dominates request latency (see JsonBlobStore).
    #   CONCURRENCY      threads used for batched get/put/delete
    #   CONNECTION_POOL  HTTPS connections kept alive; must be >= concurrency
    #                    or threads queue for sockets and pay TLS handshakes
    #   CACHE_ENABLED    serve documents from memory while their ETag is
    #                    unchanged; disable if another writer shares the
    #                    container
    #   LISTING_CACHE    seconds a prefix listing may be reused (our own
    #                    writes invalidate it immediately)
    BLOB_MAX_CONCURRENCY: int = 32
    BLOB_CONNECTION_POOL_SIZE: int = 64
    BLOB_CACHE_ENABLED: bool = True
    BLOB_LISTING_CACHE_SECONDS: float = 5.0

    # Accept `X-Recruiter-Email` as identity when no session token is sent.
    #
    # Every data endpoint used to trust that header unconditionally, with a
    # default value, so anyone could read any recruiter's candidates by
    # changing a string and no token was needed at all. It survives for the
    # test suite and local scripts; turn it off in any deployment.
    ALLOW_HEADER_IDENTITY: bool = True
    #: Identity used in header mode when no header is sent at all.
    DEFAULT_RECRUITER_EMAIL: str = "recruiter@example.com"

    # Vector index backend for semantic candidate search.
    #   "blob"   vectors persisted in the document store, exact cosine search
    #   "search" Azure AI Search vector index (needs AZURE_SEARCH_* set)
    #   "qdrant" Qdrant, a purpose-built vector database (HNSW + payload
    #            filtering). Embedded by default -- no server to run -- which
    #            also means the index lives on this machine's disk rather
    #            than being shared, so prefer "search" for a deployment more
    #            than one process talks to.
    #   "dual"   Both: Qdrant answers the vector half, Azure AI Search the
    #            keyword half, and the two rankings are fused. Each covers
    #            the other's weakness -- embeddings are unreliable on names
    #            and exact tool names, keyword search is blind to meaning.
    VECTOR_BACKEND: str = "blob"

    # Embedded storage path. Set QDRANT_URL instead to talk to a Qdrant
    # server (e.g. http://localhost:6333) and this is ignored.
    QDRANT_PATH: str = "./.qdrant"
    QDRANT_URL: Optional[str] = None
    QDRANT_API_KEY: Optional[str] = None
    QDRANT_COLLECTION: str = "resumeiq-candidates"

    # Where assessment invitations point. A placeholder host until a real
    # assessment provider is integrated — the invitation, the record and the
    # audit trail are real, the destination is not.
    ASSESSMENT_BASE_URL: str = "https://assessments.resumeiq.example/take"

    # Azure AI Document Intelligence
    AZURE_DOCUMENT_INTELLIGENCE_KEY: Optional[str] = None
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: Optional[str] = None

    # Azure OpenAI
    AZURE_OPENAI_API_KEY: Optional[str] = None
    AZURE_OPENAI_ENDPOINT: Optional[str] = None
    AZURE_OPENAI_DEPLOYMENT_NAME: str = "gpt-4o"
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME: Optional[str] = "text-embedding-3-small"
    AZURE_OPENAI_EMBEDDING_API_KEY: Optional[str] = None
    AZURE_OPENAI_EMBEDDING_ENDPOINT: Optional[str] = None
    AZURE_OPENAI_API_VERSION: str = "2024-02-15-preview"
    # Own-fallback retries: every LLM seam degrades deterministically, so the
    # SDK retrying 3x per call only multiplies outage latency.
    AZURE_OPENAI_MAX_RETRIES: int = 1

    # GPT-5 spends tokens "thinking" before it answers, and defaults to
    # medium effort. The copilot's calls are structured extraction and
    # grounded synthesis, not open problem solving, so low effort answers in
    # a fraction of the time: measured 8.5s -> 3.9s on a 11KB synthesis
    # prompt. Set "minimal" to disable reasoning, or "medium"/"high" to trade
    # latency back for depth. Ignored by non-reasoning deployments.
    AZURE_OPENAI_REASONING_EFFORT: str = "low"
    # A copilot answer used to exceed the old hardcoded 30s ceiling, retry,
    # and then fall back to the deterministic answer after ~85s of waiting.
    AZURE_OPENAI_TIMEOUT_SECONDS: float = 60.0
    # Consecutive failures before the breaker opens, and how long it stays open.
    AZURE_OPENAI_FAILURE_THRESHOLD: int = 8
    AZURE_OPENAI_BREAKER_COOLDOWN_SECONDS: float = 15.0


    # Azure AI Search
    AZURE_SEARCH_ENDPOINT: Optional[str] = None
    AZURE_SEARCH_ADMIN_KEY: Optional[str] = None
    AZURE_SEARCH_INDEX_NAME: str = "candidates-index"

    # Azure AI Foundry
    AZURE_AI_FOUNDRY_PROJECT_ID: Optional[str] = None

    # Chat-with-Your-Data accelerator (RAG chatbot service)
    # Points at chat-with-your-data-solution-accelerator-main backend (default :8000)
    CHATBOT_API_URL: Optional[str] = "http://localhost:8001"
    CHATBOT_ENABLED: bool = True
    CHATBOT_TIMEOUT_SECONDS: float = 60.0

    # Copilot model selection (server-enforced allowlist; the app has no
    # real auth system, so this is a documented, pragmatic approximation of
    # RBAC, not real authorization).
    COPILOT_MODEL_REGISTRY: List[dict] = [
        {"id": "gpt-4o", "label": "GPT-4o", "description": "Balanced default.", "is_default": True},
        {"id": "gpt-4o-mini", "label": "GPT-4o mini", "description": "Faster, lower-cost.", "is_default": False},
        {"id": "gpt-4.1", "label": "GPT-4.1", "description": "Extended reasoning.", "is_default": False},
    ]
    COPILOT_MODEL_DEPLOYMENTS: dict[str, str] = {}  # model_id -> Azure deployment name; missing -> AZURE_OPENAI_DEPLOYMENT_NAME
    COPILOT_MODEL_ALLOWLIST: dict[str, list[str]] = {}  # model_id -> emails; missing/empty = available to all
    COPILOT_DEFAULT_MODEL: str = "gpt-4o"
    COPILOT_ATTACHMENT_MAX_BYTES: int = 15 * 1024 * 1024

    # Outbound recruiter emails (approve/reject decisions).
    # Gmail: SMTP_USERNAME is the full gmail address, SMTP_PASSWORD is a 16-char
    # App Password (myaccount.google.com/apppasswords) — NOT the account password.
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_NAME: str = "ResumeIQ Recruiting"
    SMTP_FROM_EMAIL: Optional[str] = None  # defaults to SMTP_USERNAME

    # External Profile Enrichment Optional Credentials
    GITHUB_TOKEN: Optional[str] = None
    HACKERRANK_API_KEY: Optional[str] = None

    # "Sign in with Google". The web OAuth client id from
    # console.cloud.google.com/apis/credentials — must match the frontend's
    # VITE_GOOGLE_CLIENT_ID, since an ID token is only accepted for the
    # audience it was issued for. Unset disables the endpoint rather than
    # accepting tokens from an untrusted audience.
    GOOGLE_CLIENT_ID: Optional[str] = None

    # Azure Monitor / Application Insights (observability)
    # Unset by default — the Ops dashboard's own sre_events store works with
    # no Azure Monitor at all; this only enables the OpenTelemetry export.
    APPLICATIONINSIGHTS_CONNECTION_STRING: Optional[str] = None

    # Public URL of the recruiter frontend (used to build interview handoff

    # briefing links included in interviewer notification emails).
    FRONTEND_URL: str = "http://localhost:8080"

    # App Config
    API_TITLE: str = "Resume Screening Assistant API"
    API_VERSION: str = "1.0.0"
    DEBUG: bool = False
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8080",
    ]
    USE_MOCK_AZURE: bool = True
    UPLOAD_DIR: str = "./uploads"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Union[str, List[str]]) -> List[str]:
        if isinstance(value, str):
            value = value.strip()
            if value.startswith("["):
                import json

                return json.loads(value)
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("COPILOT_MODEL_DEPLOYMENTS", "COPILOT_MODEL_ALLOWLIST", mode="before")
    @classmethod
    def parse_copilot_json_dict(cls, value: Union[str, dict]) -> dict:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return {}
            import json

            return json.loads(value)
        return value

    @property
    def azure_configured(self) -> bool:
        return bool(
            self.AZURE_STORAGE_CONNECTION_STRING
            and self.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
            and self.AZURE_OPENAI_API_KEY
            and self.AZURE_OPENAI_ENDPOINT
        )

    @property
    def smtp_configured(self) -> bool:
        return bool(self.SMTP_USERNAME and self.SMTP_PASSWORD)

    @property
    def smtp_from(self) -> str:
        return self.SMTP_FROM_EMAIL or self.SMTP_USERNAME or "noreply@example.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
