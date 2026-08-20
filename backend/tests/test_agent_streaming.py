"""The streamed copilot endpoint and its progress events.

`/api/agent/ask/stream` returns the same answer as `/ask`, preceded by the
steps the agent took. These tests also pin the route wiring: the streaming
route once captured the public `/api/agent` decorators, which silently turned
the JSON endpoint into an event stream.
"""

import json


def _events(raw: str) -> list[dict]:
    return [
        json.loads(line[len("data:") :].strip())
        for line in raw.splitlines()
        if line.startswith("data:")
    ]


def test_public_agent_endpoint_still_returns_json(client, sample_job, sample_candidate):
    response = client.post(
        "/api/agent",
        json={"query": "Show me top candidates", "job_id": str(sample_job.id)},
        headers={"X-Recruiter-Email": "recruiter@example.com"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert "session_id" in response.json()


def test_stream_returns_server_sent_events(client, sample_job, sample_candidate):
    response = client.post(
        "/api/agent/ask/stream",
        json={"query": "Show me top candidates", "job_id": str(sample_job.id)},
        headers={"X-Recruiter-Email": "recruiter@example.com"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")


def test_stream_reports_progress_before_the_answer(client, sample_job, sample_candidate):
    response = client.post(
        "/api/agent/ask/stream",
        json={"query": "Show me top candidates", "job_id": str(sample_job.id)},
        headers={"X-Recruiter-Email": "recruiter@example.com"},
    )
    events = _events(response.text)
    kinds = [e["type"] for e in events]

    assert "progress" in kinds
    assert kinds[-1] == "result", "the answer is the last event"
    assert kinds.index("result") == len(kinds) - 1
    # Progress is human-readable, not internal identifiers.
    for event in events:
        if event["type"] == "progress":
            assert event["detail"] and not event["detail"].startswith("_")


def test_stream_result_carries_the_same_fields_as_ask(client, sample_job, sample_candidate):
    streamed = _events(
        client.post(
            "/api/agent/ask/stream",
            json={"query": "Show me top candidates", "job_id": str(sample_job.id)},
            headers={"X-Recruiter-Email": "recruiter@example.com"},
        ).text
    )[-1]
    plain = client.post(
        "/api/agent/ask",
        json={"query": "Show me top candidates", "job_id": str(sample_job.id)},
        headers={"X-Recruiter-Email": "recruiter@example.com"},
    ).json()

    for field in ("session_id", "response", "citations", "engine", "job_id"):
        assert field in streamed, f"streamed result is missing {field}"
        assert field in plain
    assert isinstance(streamed["response"], str) and streamed["response"]
