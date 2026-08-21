"""Aggregates `sre_events` into the Ops/SRE dashboard response shapes.

Mirrors `hiring_insights.py`'s style: a thin service class doing Python-side
bucketing/counting over a list pulled once per request, exposed as a module
singleton.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.services import sre_events
from app.services.azure_services import openai_service

REQUEST_BUCKET_MINUTES = 5

# Hardcoded Phase 1 health thresholds — not user-configurable yet.
BACKEND_ERROR_RATE_CRITICAL = 0.10
BACKEND_ERROR_RATE_DEGRADED = 0.01
AI_FAILURE_RATE_DEGRADED = 0.20
DOC_INTEL_FAILURE_RATE_CRITICAL = 0.50
DOC_INTEL_FAILURE_RATE_DEGRADED = 0.20
AGENT_FALLBACK_RATE_CRITICAL = 0.50
AGENT_FALLBACK_RATE_DEGRADED = 0.20

_STATUS_RANK = {"healthy": 0, "degraded": 1, "critical": 2, "unknown": 1}

AI_SERVICES = [
    ("azure_openai_chat", "Azure OpenAI (Chat)"),
    ("azure_openai_embeddings", "Azure OpenAI (Embeddings)"),
    ("document_intelligence", "Azure AI Document Intelligence"),
]


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(pct * (len(ordered) - 1))))
    return ordered[index]


def _worst_status(statuses: list[str]) -> str:
    return max(statuses, key=lambda s: _STATUS_RANK.get(s, 1)) if statuses else "unknown"


class SreMetricsService:
    def _events(self, hours: int, event_type: Optional[str] = None, service: Optional[str] = None):
        events = sre_events.list_recent(hours)
        if event_type is not None:
            events = [e for e in events if e.event_type == event_type]
        if service is not None:
            events = [e for e in events if e.service == service]
        return events

    # ---------- Application health ----------

    def get_request_health(self, hours: int = 1) -> dict:
        events = self._events(hours, event_type="http_request", service="backend")
        total = len(events)
        errors = sum(1 for e in events if e.status == "failure")
        durations = [e.duration_ms for e in events]

        now = datetime.now(timezone.utc)
        window_start = now - timedelta(hours=hours)
        bucket_span = timedelta(minutes=REQUEST_BUCKET_MINUTES)
        buckets: dict[datetime, dict] = {}
        cursor = window_start
        while cursor <= now:
            buckets[cursor] = {"count": 0, "error_count": 0, "durations": []}
            cursor += bucket_span

        for event in events:
            created = event.created_at.replace(tzinfo=timezone.utc) if event.created_at.tzinfo is None else event.created_at
            offset = created - window_start
            bucket_index = int(offset / bucket_span)
            bucket_start = window_start + bucket_index * bucket_span
            bucket = buckets.get(bucket_start)
            if bucket is None:
                continue
            bucket["count"] += 1
            if event.status == "failure":
                bucket["error_count"] += 1
            bucket["durations"].append(event.duration_ms)

        bucket_list = [
            {
                "bucket_start": start,
                "count": data["count"],
                "error_count": data["error_count"],
                "avg_latency_ms": round(sum(data["durations"]) / len(data["durations"]), 1)
                if data["durations"]
                else 0.0,
            }
            for start, data in sorted(buckets.items())
        ]

        return {
            "window_hours": hours,
            "total_requests": total,
            "error_rate_pct": round((errors / total) * 100, 2) if total else 0.0,
            "avg_latency_ms": round(sum(durations) / len(durations), 1) if durations else 0.0,
            "p95_latency_ms": round(_percentile(durations, 0.95), 1),
            "buckets": bucket_list,
        }

    def get_endpoint_breakdown(self, hours: int = 1, limit: int = 20) -> dict:
        """Per-endpoint (method + path) request/error breakdown — "which API
        failed", not just the aggregate rate `get_request_health` reports.
        Groups by the exact recorded path (no route-template normalization
        like `/api/candidates/{id}` yet — a real UUID in the path means each
        candidate gets its own row today); good enough to spot a hot failing
        endpoint, not a perfect cardinality-bounded rollup.
        """
        events = self._events(hours, event_type="http_request", service="backend")
        by_endpoint: dict[tuple[str, str], list] = defaultdict(list)
        for event in events:
            method = event.details.get("method", "?")
            path = event.details.get("path", "?")
            by_endpoint[(method, path)].append(event)

        rows = []
        for (method, path), endpoint_events in by_endpoint.items():
            count = len(endpoint_events)
            errors = sum(1 for e in endpoint_events if e.status == "failure")
            durations = [e.duration_ms for e in endpoint_events]
            rows.append(
                {
                    "method": method,
                    "path": path,
                    "count": count,
                    "error_count": errors,
                    "error_rate_pct": round((errors / count) * 100, 2) if count else 0.0,
                    "avg_latency_ms": round(sum(durations) / len(durations), 1) if durations else 0.0,
                }
            )

        rows.sort(key=lambda r: (r["error_count"], r["count"]), reverse=True)
        return {"window_hours": hours, "endpoints": rows[:limit]}

    def _backend_status(self, request_health: dict) -> str:
        if request_health["total_requests"] == 0:
            return "healthy"
        error_rate = request_health["error_rate_pct"] / 100
        if error_rate >= BACKEND_ERROR_RATE_CRITICAL:
            return "critical"
        if error_rate >= BACKEND_ERROR_RATE_DEGRADED:
            return "degraded"
        return "healthy"

    # ---------- AI service monitoring ----------

    def get_ai_service_health(self, hours: int = 1) -> dict:
        events = self._events(hours, event_type="ai_call")
        by_service: dict[str, list] = defaultdict(list)
        for event in events:
            by_service[event.service].append(event)

        services = []
        for service_key, label in AI_SERVICES:
            service_events = by_service.get(service_key, [])
            call_count = len(service_events)
            failure_count = sum(1 for e in service_events if e.status == "failure")
            fallback_count = sum(1 for e in service_events if e.status == "fallback")
            mock_count = sum(1 for e in service_events if e.details.get("mock"))
            durations = [e.duration_ms for e in service_events]

            stat = {
                "service": service_key,
                "label": label,
                "call_count": call_count,
                "failure_count": failure_count,
                "fallback_count": fallback_count,
                "avg_latency_ms": round(sum(durations) / len(durations), 1) if durations else 0.0,
                "p95_latency_ms": round(_percentile(durations, 0.95), 1),
                "mock_call_pct": round((mock_count / call_count) * 100, 2) if call_count else 0.0,
                "breaker_open": None,
                "consecutive_failures": None,
            }
            if service_key in ("azure_openai_chat", "azure_openai_embeddings"):
                breaker = openai_service.breaker_state
                stat["breaker_open"] = breaker["is_open"]
                stat["consecutive_failures"] = breaker["consecutive_failures"]
            services.append(stat)

        return {"window_hours": hours, "services": services}

    def _ai_service_status(self, ai_health: dict) -> str:
        statuses = []
        for stat in ai_health["services"]:
            if stat["breaker_open"]:
                statuses.append("critical")
                continue
            if stat["call_count"] == 0:
                statuses.append("healthy")
                continue
            failure_rate = (stat["failure_count"] + stat["fallback_count"]) / stat["call_count"]
            if stat["service"] == "document_intelligence":
                if failure_rate >= DOC_INTEL_FAILURE_RATE_CRITICAL:
                    statuses.append("critical")
                elif failure_rate >= DOC_INTEL_FAILURE_RATE_DEGRADED:
                    statuses.append("degraded")
                else:
                    statuses.append("healthy")
            else:
                statuses.append("degraded" if failure_rate >= AI_FAILURE_RATE_DEGRADED else "healthy")
        return _worst_status(statuses)

    # ---------- Agent / API monitoring ----------

    def get_agent_health(self, hours: int = 1) -> dict:
        events = self._events(hours, event_type="agent_turn", service="copilot_agent")
        total = len(events)
        deterministic = sum(1 for e in events if e.details.get("engine") == "deterministic")
        agent = sum(1 for e in events if e.details.get("engine") == "agent")
        fallback = sum(1 for e in events if e.status == "fallback")

        tool_counts: Counter = Counter(
            e.details.get("tool") for e in events if e.details.get("tool")
        )
        tool_usage = [
            {"tool": tool, "count": count}
            for tool, count in tool_counts.most_common()
        ]

        return {
            "window_hours": hours,
            "total_turns": total,
            "deterministic_turns": deterministic,
            "agent_turns": agent,
            "fallback_turns": fallback,
            "fallback_rate_pct": round((fallback / total) * 100, 2) if total else 0.0,
            "tool_usage": tool_usage,
        }

    def _agent_status(self, agent_health: dict) -> str:
        if agent_health["total_turns"] == 0:
            return "healthy"
        fallback_rate = agent_health["fallback_rate_pct"] / 100
        if fallback_rate >= AGENT_FALLBACK_RATE_CRITICAL:
            return "critical"
        if fallback_rate >= AGENT_FALLBACK_RATE_DEGRADED:
            return "degraded"
        return "healthy"

    # ---------- Logs / diagnostics ----------

    def get_recent_logs(
        self,
        hours: int = 1,
        status: Optional[str] = None,
        limit: int = 200,
    ) -> dict:
        """Most recent events across every event type, newest first —
        the "centralized logs" view for local/dev use. Full-text KQL search
        over real Azure Monitor Log Analytics is a Phase 2 item that needs a
        live deployed environment; this is the local-mode substitute."""
        events = self._events(hours)
        if status is not None:
            events = [e for e in events if e.status == status]
        events = sorted(events, key=lambda e: e.created_at, reverse=True)
        total_count = len(events)
        entries = [
            {
                "created_at": e.created_at,
                "event_type": e.event_type,
                "service": e.service,
                "status": e.status,
                "duration_ms": e.duration_ms,
                "error_message": e.error_message,
                "details": e.details,
            }
            for e in events[:limit]
        ]
        return {"window_hours": hours, "total_count": total_count, "entries": entries}

    # ---------- Overview ----------

    def get_overview(self, hours: int = 1) -> dict:
        request_health = self.get_request_health(hours)
        ai_health = self.get_ai_service_health(hours)
        agent_health = self.get_agent_health(hours)

        backend_status = self._backend_status(request_health)
        ai_status = self._ai_service_status(ai_health)
        agent_status = self._agent_status(agent_health)

        services = [
            {
                "service": "backend",
                "label": "Backend API",
                "status": backend_status,
                "detail": f"{request_health['total_requests']} requests, "
                f"{request_health['error_rate_pct']}% errors (last {hours}h)",
            },
            {
                "service": "ai_services",
                "label": "AI Services (OpenAI / Document Intelligence)",
                "status": ai_status,
                "detail": ", ".join(
                    f"{s['label']}: {s['call_count']} calls"
                    for s in ai_health["services"]
                )
                or "No AI calls recorded",
            },
            {
                "service": "copilot_agent",
                "label": "Recruiter Copilot Agent",
                "status": agent_status,
                "detail": f"{agent_health['total_turns']} turns, "
                f"{agent_health['fallback_rate_pct']}% fallback (last {hours}h)",
            },
        ]

        return {
            "generated_at": datetime.now(timezone.utc).replace(tzinfo=None),
            "overall_status": _worst_status([s["status"] for s in services]),
            "services": services,
        }


sre_metrics = SreMetricsService()
