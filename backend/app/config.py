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

    # Database (SQLite by default for zero-setup local runs)
    DATABASE_URL: str = "sqlite:///./resume_assistant.db"

    # Azure Blob Storage
    AZURE_STORAGE_CONNECTION_STRING: Optional[str] = None
    AZURE_BLOB_CONTAINER_NAME: str = "resumes"

    # Azure AI Document Intelligence
    AZURE_DOCUMENT_INTELLIGENCE_KEY: Optional[str] = None
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT: Optional[str] = None

    # Azure OpenAI
    AZURE_OPENAI_API_KEY: Optional[str] = None
    AZURE_OPENAI_ENDPOINT: Optional[str] = None
    AZURE_OPENAI_DEPLOYMENT_NAME: str = "gpt-4o"
    # Separate deployment on the same resource, used for real semantic skill
    # matching. Independently gated from AZURE_OPENAI_DEPLOYMENT_NAME (chat)
    # since one deployment can be ready before the other.
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME: Optional[str] = "text-embedding-3-small"
    AZURE_OPENAI_API_VERSION: str = "2024-02-15-preview"

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

    # Outbound recruiter emails (approve/reject decisions).
    # Gmail: SMTP_USERNAME is the full gmail address, SMTP_PASSWORD is a 16-char
    # App Password (myaccount.google.com/apppasswords) — NOT the account password.
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_NAME: str = "ResumeIQ Recruiting"
    SMTP_FROM_EMAIL: Optional[str] = None  # defaults to SMTP_USERNAME

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
