import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    """Timezone-aware, unlike most other models' `_utcnow()` (e.g.
    `models/evaluation.py`), which strip tzinfo before storing. Kept aware
    here on purpose: Pydantic then serializes with a `Z`/offset suffix, so
    the frontend's `new Date(...)` parses it as UTC instead of silently
    treating a timezone-less string as local time (which is what the JS
    Date constructor does — a real bug this fixes in the Ops Diagnostics
    tab, where timestamps were showing up in the wrong AM/PM)."""
    return datetime.now(timezone.utc)


class SreEvent(BaseModel):
    """One telemetry event for the Ops/SRE dashboard.

    Deliberately not part of the `Store` facade — see
    `app/services/sre_events.py` for why (circular import with
    `azure_services.py`, where most events originate).
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    event_type: str  # "http_request" | "ai_call" | "agent_turn"
    service: str
    # "backend" | "azure_openai_chat" | "azure_openai_embeddings"
    # | "document_intelligence" | "copilot_agent"
    status: str  # "success" | "failure" | "fallback"
    duration_ms: float
    error_message: Optional[str] = None
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=_utcnow)
