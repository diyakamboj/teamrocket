from app.services import sre_events


def test_overview_healthy_with_no_traffic(client, isolated_sre_store):
    response = client.get("/api/ops/overview")
    assert response.status_code == 200
    body = response.json()
    assert body["overall_status"] == "healthy"
    assert {s["service"] for s in body["services"]} == {
        "backend",
        "ai_services",
        "copilot_agent",
    }


def test_request_health_reflects_recorded_events(client, isolated_sre_store):
    sre_events.record_event(
        event_type="http_request", service="backend", status="success", duration_ms=50.0
    )
    sre_events.record_event(
        event_type="http_request", service="backend", status="failure", duration_ms=100.0
    )

    response = client.get("/api/ops/requests?hours=1")
    assert response.status_code == 200
    body = response.json()
    assert body["total_requests"] == 2
    assert body["error_rate_pct"] == 50.0


def test_ai_service_health_reports_mock_calls(client, isolated_sre_store):
    sre_events.record_event(
        event_type="ai_call",
        service="azure_openai_chat",
        status="success",
        duration_ms=12.0,
        details={"mock": True},
    )

    response = client.get("/api/ops/ai-services?hours=1")
    assert response.status_code == 200
    services = {s["service"]: s for s in response.json()["services"]}
    assert services["azure_openai_chat"]["call_count"] == 1
    assert services["azure_openai_chat"]["mock_call_pct"] == 100.0
    assert services["azure_openai_chat"]["breaker_open"] is False


def test_agent_health_reports_deterministic_and_fallback(client, isolated_sre_store):
    sre_events.record_event(
        event_type="agent_turn",
        service="copilot_agent",
        status="success",
        duration_ms=5.0,
        details={"engine": "deterministic", "tool": "search_candidates"},
    )
    sre_events.record_event(
        event_type="agent_turn",
        service="copilot_agent",
        status="fallback",
        duration_ms=8.0,
        details={"engine": "agent_failed_deterministic_fallback", "tool": None},
    )

    response = client.get("/api/ops/agent?hours=1")
    assert response.status_code == 200
    body = response.json()
    assert body["total_turns"] == 2
    assert body["deterministic_turns"] == 1
    assert body["fallback_turns"] == 1
    assert body["tool_usage"] == [{"tool": "search_candidates", "count": 1}]


def test_endpoint_breakdown_ranks_failing_endpoint_first(client, isolated_sre_store):
    sre_events.record_event(
        event_type="http_request",
        service="backend",
        status="success",
        duration_ms=10.0,
        details={"method": "GET", "path": "/api/jobs", "status_code": 200},
    )
    sre_events.record_event(
        event_type="http_request",
        service="backend",
        status="failure",
        duration_ms=500.0,
        details={"method": "POST", "path": "/api/resumes/upload", "status_code": 500},
    )
    sre_events.record_event(
        event_type="http_request",
        service="backend",
        status="failure",
        duration_ms=520.0,
        details={"method": "POST", "path": "/api/resumes/upload", "status_code": 500},
    )

    response = client.get("/api/ops/endpoints?hours=1")
    assert response.status_code == 200
    endpoints = response.json()["endpoints"]
    assert endpoints[0]["path"] == "/api/resumes/upload"
    assert endpoints[0]["method"] == "POST"
    assert endpoints[0]["count"] == 2
    assert endpoints[0]["error_count"] == 2
    assert endpoints[0]["error_rate_pct"] == 100.0


def test_logs_endpoint_filters_by_status(client, isolated_sre_store):
    sre_events.record_event(
        event_type="ai_call", service="document_intelligence", status="success", duration_ms=1.0
    )
    sre_events.record_event(
        event_type="ai_call",
        service="document_intelligence",
        status="failure",
        duration_ms=2.0,
        error_message="timed out",
    )

    all_logs = client.get("/api/ops/logs?hours=1").json()
    assert all_logs["total_count"] == 2

    failures_only = client.get("/api/ops/logs?hours=1&status=failure").json()
    assert failures_only["total_count"] == 1
    assert failures_only["entries"][0]["error_message"] == "timed out"


def test_ops_endpoints_are_excluded_from_their_own_request_health(client, isolated_sre_store):
    """Polling /api/ops/* itself must not inflate request-health numbers —
    see middleware.py's _EXCLUDED_PREFIXES."""
    client.get("/api/ops/overview")
    client.get("/api/ops/overview")

    response = client.get("/api/ops/requests?hours=1")
    assert response.json()["total_requests"] == 0
