from app.services import sre_events


def test_record_and_list_recent(isolated_sre_store):
    sre_events.record_event(
        event_type="ai_call",
        service="azure_openai_chat",
        status="success",
        duration_ms=42.0,
        details={"mock": True},
    )
    sre_events.record_event(
        event_type="http_request",
        service="backend",
        status="failure",
        duration_ms=10.0,
        error_message="boom",
    )

    events = sre_events.list_recent(hours=1)
    assert len(events) == 2
    types = {e.event_type for e in events}
    assert types == {"ai_call", "http_request"}
    failure = next(e for e in events if e.event_type == "http_request")
    assert failure.status == "failure"
    assert failure.error_message == "boom"


def test_record_event_never_raises(monkeypatch):
    """record_event is best-effort — a broken backing store must not
    propagate into the caller (an AI/agent call site)."""

    class BrokenStore:
        def put(self, key, doc):
            raise RuntimeError("disk full")

    monkeypatch.setattr(sre_events, "document_store", BrokenStore())
    sre_events.record_event(event_type="ai_call", service="x", status="success", duration_ms=1.0)


def test_list_recent_empty(isolated_sre_store):
    assert sre_events.list_recent(hours=1) == []
