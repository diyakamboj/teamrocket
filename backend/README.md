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
| POST | `/api/agent/ask` | Recruiter copilot |
| GET | `/api/agent/sessions` | Copilot chat history |

Optional header for audit trail: `X-Recruiter-Email: you@company.com`

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
