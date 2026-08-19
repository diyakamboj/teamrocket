"""Request correlation id + request-health telemetry.

Adds an `X-Request-ID` to every response (generating one if the caller
didn't send one) and logs a one-line summary per request. Also records an
`http_request` SRE event per request via `app.services.sre_events`, which
is what powers the Application Health section of the Ops dashboard.

`/api/ops/*` and `/health` are excluded from event recording so the
dashboard polling itself every few seconds doesn't inflate its own
request-health numbers.
"""

from __future__ import annotations

import time
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.utils.logger import get_logger

logger = get_logger(__name__)

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

_EXCLUDED_PREFIXES = ("/api/ops", "/health")


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Local import: app.services.sre_events imports app.services.azure_services
        # at module level, and this middleware is wired up in main.py before
        # azure_services' singletons are guaranteed constructed in every import
        # order — importing lazily here avoids any ordering fragility.
        from app.services import sre_events

        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        token = request_id_var.set(request_id)
        start = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            self._record(request, 500, start, sre_events)
            request_id_var.reset(token)
            raise

        duration_ms = (time.monotonic() - start) * 1000
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "%s %s -> %s (%.1fms) request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            request_id,
        )
        self._record(request, response.status_code, start, sre_events)
        request_id_var.reset(token)
        return response

    def _record(self, request: Request, status_code: int, start: float, sre_events) -> None:
        if request.url.path.startswith(_EXCLUDED_PREFIXES):
            return
        sre_events.record_event(
            event_type="http_request",
            service="backend",
            status="success" if status_code < 500 else "failure",
            duration_ms=(time.monotonic() - start) * 1000,
            details={
                "method": request.method,
                "path": request.url.path,
                "status_code": status_code,
            },
        )
