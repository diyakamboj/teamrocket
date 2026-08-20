# Resume Screening Assistant — Backend

Production-oriented FastAPI backend for the ResumeIQ / Resume Screening Assistant frontend (`frontend`).

## Features

- Bulk resume upload + OCR/parsing pipeline (Azure Blob + Document Intelligence + OpenAI)
- Job description analysis and requirement extraction
- Hybrid candidate ranking (keyword + semantic overlap + LLM explanation)
- Evidence tracing for matched skills
- Side-by-side candidate comparison
- Hiring insights dashboard APIs
- Recruiter AI copilot with chat sessions
- AI-powered interview scheduling with Outlook calendar availability & Microsoft Teams meeting link generation
- Blind-review mode helpers and audit logging

## Stack


- Python 3.11+ / FastAPI / SQLAlchemy / Alembic
- PostgreSQL
- Azure Blob Storage, Document Intelligence, OpenAI, AI Search

## Project layout

```text
backend/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models/
│   ├── services/
│   ├── routes/
│   └── utils/
├── tests/
├── migrations/
├── requirements.txt
├── docker-compose.yml
└── .env.example
```

## Quick start

```bash
cd backend

# 1) Local infra (Azurite, optional — only needed to exercise the real
#    Azure Blob Storage code path instead of mock mode)
docker compose up -d

# 2) Python env
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3) Environment
cp .env.example .env
# Edit Azure credentials when ready. Keep USE_MOCK_AZURE=true for local mock mode.

# 4) Run API
uvicorn app.main:app --reload --port 8000
```

There is no database to migrate or provision — all structured data (candidates,
jobs, evaluations, ...) is stored as JSON documents via the blob store (see
`app/services/azure_services.py`'s `JsonBlobStore` and `app/storage/`), which
in mock mode writes to `UPLOAD_DIR/documents/` on local disk with zero setup.

API docs: [http://localhost:8000/docs](http://localhost:8000/docs)  
Health: [http://localhost:8000/health](http://localhost:8000/health)

## Core endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/resumes/upload` | Bulk upload resumes |
| GET | `/api/resumes/{resume_id}` | Upload/parse status + parsed candidate |
| POST | `/api/resumes/{resume_id}/parse` | Re-parse |
| POST | `/api/jobs` | Create job |
| PUT | `/api/jobs/{job_id}` | Update job |
| POST | `/api/jobs/{job_id}/analyze` | AI extract requirements |
| GET | `/api/candidates/rank?job_id=` | Rank candidates |
| GET | `/api/candidates/{id}/score?job_id=` | Detailed score |
| POST | `/api/candidates/{id}/enrich` | Enrich from public profiles |
| POST | `/api/evaluation/compare` | Compare candidates |
| GET | `/api/evaluation/{id}/evidence` | Evidence citations |
| POST | `/api/evaluation/{candidate_id}/{job_id}/blind-review` | Toggle blind review |
| GET | `/api/dashboard/job/{job_id}/insights` | Hiring insights |
| GET | `/api/dashboard/job/{job_id}/distribution` | Score distribution |
| POST | `/api/agent` | Public endpoint for Recruiter AI Agent queries |
| POST | `/api/agent/ask` | Recruiter copilot frontend endpoint |
| GET | `/api/agent/sessions` | Copilot chat history |
| GET | `/api/interviews/interviewers` | List available internal interviewers |
| POST | `/api/interviews/propose` | AI calculate available interview slots |
| POST | `/api/interviews/confirm` | Confirm booking, create Teams link & Outlook invite |
| GET | `/api/interviews/candidate/{id}` | List interviews for a candidate |
| POST | `/api/interviews/{id}/reschedule-propose` | Propose new slots for rescheduling |
| POST | `/api/interviews/{id}/reschedule-confirm` | Confirm rescheduled time slot |
| POST | `/api/interviews/{id}/cancel` | Cancel interview and notify participants |

Optional header for audit trail: `X-Recruiter-Email: you@company.com`

## Public Agent API Example

The AI Agent can be called from external clients or services via `POST /api/agent`:

### Request Payload

```json
{
  "query": "Schedule a 45-minute technical interview with this candidate sometime next week when both Alex and Priya are available.",
  "job_id": "optional-job-uuid",
  "candidate_id": "optional-candidate-uuid",
  "blind_mode": false
}
```

*(Note: Accepts either `"query"` or `"question"` field for the user request).*

### cURL

```bash
curl -X POST http://localhost:8000/api/agent \
  -H "Content-Type: application/json" \
  -H "X-Recruiter-Email: recruiter@example.com" \
  -d '{
    "query": "Show me top candidates for the Backend Engineer role"
  }'
```

### JavaScript / TypeScript Fetch

```typescript
const response = await fetch("http://localhost:8000/api/agent", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Recruiter-Email": "recruiter@example.com",
  },
  body: JSON.stringify({
    query: "Which candidates satisfy all must-have requirements?",
  }),
});
const data = await response.json();
console.log(data.response, data.structured);
```

### Python

```python
import requests

res = requests.post(
    "http://localhost:8000/api/agent",
    headers={"X-Recruiter-Email": "recruiter@example.com"},
    json={"query": "Compare top candidates side by side"}
)
data = res.json()
print("Agent Response:", data["response"])
```


## Performance

Two things dominate request latency: blob round-trips and the model.

### Blob storage

Every entity is a JSON document in Blob Storage, so a round-trip (~40ms) is
this app's equivalent of a database query, and latency is mostly a count of
them. Four mechanisms keep that count down:

| Mechanism | Effect |
|---|---|
| Batched I/O | `get_many`/`put_many`/`delete_many` run on one shared pool (`BLOB_MAX_CONCURRENCY`) instead of a read per document |
| Sized connection pool | `BLOB_CONNECTION_POOL_SIZE` must be >= concurrency, or threads queue for sockets and pay fresh TLS handshakes |
| ETag cache | A listing returns every blob's ETag in one round-trip, so re-reading an unchanged collection downloads nothing (`BLOB_CACHE_ENABLED`) |
| Layout | Evidence is one document per evaluation, and history is partitioned by candidate, rather than a blob per row |

Measured against the 400-candidate dataset on real Blob Storage:

| Endpoint | Before | After (cold process) | After (warm) |
|---|---|---|---|
| `GET /api/handoff/history/{id}` | 297.7s | 14.1s | 2.2s |
| `GET /api/candidates/rank` | 60.8s | 3.6s | 2.5s |
| `GET /api/dashboard/jobs` | 37.5s | 1.6s | 0.02s |
| `GET /api/candidates` | 10.0s | 1.8s | 0.02s |

The cache assumes this app is the only writer to its container, which holds
for the single-worker deployment the pipeline starts. Set
`BLOB_CACHE_ENABLED=false` if that stops being true.

Two collections changed shape. Both old layouts are still read — and read
*together* with the new ones, so nothing is hidden — which means nothing
breaks before migrating. History stays slow until the flat documents are
gone, because a candidate's events may be in either layout:

```bash
python3 scripts/compact_blob_documents.py            # dry run, reports only
python3 scripts/compact_blob_documents.py --apply
```

### Copilot answers

A copilot answer used to take ~85s and then return the *deterministic*
fallback, because each model call exceeded the old hardcoded 30s timeout,
retried, and failed. Two settings fixed that:
`AZURE_OPENAI_REASONING_EFFORT=low` (GPT-5 defaults to medium, and these
calls are extraction and grounded synthesis, not open problem solving) and
`AZURE_OPENAI_TIMEOUT_SECONDS=60`. Answers now take ~20s and come from the
agent path.

`POST /api/agent/ask/stream` returns the same answer as `/ask` as server-sent
events, reporting each step the agent takes — reading the scored pool,
choosing a tool, running it, writing the answer — which is what the chat UI
shows instead of a spinner. `/ask` is unchanged for non-streaming clients.

## Mock mode

When `USE_MOCK_AZURE=true` (default in `.env.example`):

- Uploads are stored under `./uploads/blobs`
- Document Intelligence returns sample/OCR text (or raw `.txt` content)
- OpenAI/Search calls use deterministic mock responses

Set `USE_MOCK_AZURE=false` and fill Azure keys for live integrations.

## Tests

```bash
pytest tests/ -v
```

Tests run against in-memory SQLite with mocked Azure services.

## Chatbot integration (Chat-with-Your-Data)

The Recruiter Copilot BFF lives at:

- `GET /api/agent/status` — local agent + CWYD reachability
- `POST /api/agent/ask` — frontend entrypoint

Flow:

1. Frontend calls screening API `/api/agent/ask`
2. Backend ranks candidates and builds recruiter context
3. If `CHATBOT_ENABLED=true`, forwards to CWYD `POST {CHATBOT_API_URL}/api/conversation`
4. Falls back to local OpenAI/mock agent when CWYD is unavailable

```env
CHATBOT_API_URL=http://localhost:8001
CHATBOT_ENABLED=true
```

## Frontend integration

Point the ResumeIQ frontend at:

```text
http://localhost:8000
```

Suggested CORS origins are already included for local Vite/dev servers (`8080`, `5173`, `3000`).
