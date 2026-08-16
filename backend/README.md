# Resume Screening Assistant — Backend

Production-oriented FastAPI backend for the ResumeIQ / Resume Screening Assistant frontend (`frontend`).

## Features

- Bulk resume upload + OCR/parsing pipeline (Azure Blob + Document Intelligence + OpenAI)
- Job description analysis and requirement extraction
- Hybrid candidate ranking (keyword + semantic overlap + LLM explanation)
- Evidence tracing for matched skills
- Candidate status flags (🟢 Top Match, 👥 Bench Candidate, 🚀 Immediate Joiner, ⚠️ Incomplete Profile) and evidence-linked skill/certification badges
- Interactive L1 preliminary screening: candidate-specific question plans, scored answers, screening evidence fed back into the evaluation, and a pre-interview briefing
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

# 1) Local infra (Postgres + Azurite)
docker compose up -d

# 2) Python env
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3) Environment
cp .env.example .env
# Edit Azure credentials when ready. Keep USE_MOCK_AZURE=true for local mock mode.

# 4) Migrations
alembic upgrade head

# 5) Run API
uvicorn app.main:app --reload --port 8000
```

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
| GET | `/api/candidates/{id}/badges?job_id=` | Status flags + verified skill badges (`job_id` optional) |
| POST | `/api/candidates/{id}/enrich` | Enrich from public profiles |
| POST | `/api/evaluation/compare` | Compare candidates |
| GET | `/api/evaluation/{id}/evidence` | Evidence citations |
| POST | `/api/evaluation/{candidate_id}/{job_id}/blind-review` | Toggle blind review |
| GET | `/api/dashboard/job/{job_id}/insights` | Hiring insights |
| GET | `/api/dashboard/job/{job_id}/distribution` | Score distribution |
| POST | `/api/agent/ask` | Recruiter copilot (also drives L1 screening — see below) |
| GET | `/api/agent/sessions` | Copilot chat history |
| POST | `/api/screening/sessions` | Start an L1 screening + generate its questions |
| GET | `/api/screening/sessions` | List screenings (`?candidate_id=` to filter) |
| GET | `/api/screening/sessions/{id}` | Session state: plan, transcript, scorecard |
| POST | `/api/screening/sessions/{id}/answer` | Record + score an answer, return the next question |
| POST | `/api/screening/sessions/{id}/skip` | Move past the current question |
| POST | `/api/screening/sessions/{id}/complete` | End early and generate the briefing |
| GET | `/api/screening/sessions/{id}/briefing` | Pre-interview briefing |

Optional header for audit trail: `X-Recruiter-Email: you@company.com`

## L1 preliminary screening

```text
POST /api/screening/sessions          → question plan built from THIS candidate
   ├── candidate_id + job_id            profile + job + evaluation + prior evidence
   └── or inline candidate + job_id     for rows that exist only client-side
        │
        ▼
POST .../answer  (repeat)             → rubric scores coverage / depth / clarity,
        │                               returns the next question. State lives in
        │                               screening_sessions, so the conversation
        │                               survives reloads and model outages.
        ▼
completed                             → scorecard + pre-interview briefing, and
                                        screening evidence written onto the
                                        candidate's evaluation (source section
                                        "L1 Screening"; re-ranking preserves it)
```

The same workflow runs from the copilot chat box: “start screening for
&lt;name&gt;” opens a session bound to that chat thread, subsequent messages are
recorded as the candidate's answers, and “skip” / “stop screening” /
“briefing for &lt;name&gt;” control it. Answers are scored deterministically; a
configured model can adjust a score within a bounded range and add wording,
but never invents the evidence.

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
