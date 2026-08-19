"""Lightweight in-process SRE/ops telemetry event store.

Deliberately NOT part of `app.storage.store.Store` / `Repository`:
`app/storage/store.py` imports `document_store` from
`app/services/azure_services.py`, and the AI-service call sites that need to
record events (`AzureOpenAIService.chat_text`/`embed_texts`,
`AzureDocumentIntelligenceService.extract_text`) live *inside*
`azure_services.py`. If this module were reached via `Store`,
`azure_services.py` would need to import `app.storage.store` at module
level, which imports back from `azure_services.py` — a circular import.

Fix: this module sits directly on the `document_store` singleton that
`azure_services.py` already exports at module level, independent of
`Store`/`Repository` entirely. Callers *inside* `azure_services.py` must
import this module locally (inside the function body, not at module top) —
see the call sites in that file for why the reverse top-level import would
recreate the cycle.

Writes are hour-bucketed (`sre_events/{YYYYMMDDHH}/{sortable_id}.json`) so
reads stay bounded to the requested window instead of a full-collection
scan, unlike `Repository.list_all()`'s prefix listing.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.models.sre import SreEvent
from app.services.azure_services import document_store
from app.storage.ids import new_sortable_id
from app.utils.logger import get_logger

logger = get_logger(__name__)

COLLECTION = "sre_events"


def record_event(
    *,
    event_type: str,
    service: str,
    status: str,
    duration_ms: float,
    error_message: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> None:
    """Best-effort — never raises, so a telemetry bug can't break a request."""
    try:
        event = SreEvent(
            event_type=event_type,
            service=service,
            status=status,
            duration_ms=duration_ms,
            error_message=error_message,
            details=details or {},
        )
        bucket = event.created_at.strftime("%Y%m%d%H")
        key = f"{COLLECTION}/{bucket}/{new_sortable_id()}.json"
        document_store.put(key, event.model_dump(mode="json"))
    except Exception:
        logger.debug(
            "Failed to record SRE event (%s/%s)", event_type, service, exc_info=True
        )


def list_recent(hours: int = 24) -> list[SreEvent]:
    """Events from the last `hours`, only reading the hour-bucket prefixes
    in range rather than the whole `sre_events` collection."""
    now = datetime.now(timezone.utc)
    buckets = dict.fromkeys(
        (now - timedelta(hours=h)).strftime("%Y%m%d%H") for h in range(hours + 1)
    )
    events: list[SreEvent] = []
    for bucket in buckets:
        for key in document_store.list_prefix(f"{COLLECTION}/{bucket}"):
            doc = document_store.get(key)
            if doc is not None:
                event = SreEvent.model_validate(doc)
                if event.created_at.tzinfo is None:
                    # Events written before `_utcnow()` started returning
                    # aware datetimes are still naive on disk — normalize on
                    # read so old and new events sort/compare together
                    # instead of raising "can't compare offset-naive and
                    # offset-aware datetimes".
                    event.created_at = event.created_at.replace(tzinfo=timezone.utc)
                events.append(event)
    return sorted(events, key=lambda e: e.created_at)
