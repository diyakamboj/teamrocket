# ResumeIQ — Development Guide (phase-1)

How to set up and run the **phase-1** monorepo locally.

## Prerequisites

- Node 20+ and npm
- Python 3.11+
- Optional: Azure credentials for live AI (otherwise `USE_MOCK_AZURE=true` in `backend/.env`)

## Project layout

```text
frontend/    # Recruiter UI — http://localhost:8080
backend/     # FastAPI API — http://localhost:8000
copilot/     # Optional CWYD RAG service — http://localhost:8001
docs/        # Architecture and AI design docs
```

## Quick start

```bash
# From repo root
npm install

# Terminal 1 — frontend
npm run dev

# Terminal 2 — backend
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Optional Terminal 3 — CWYD copilot (see copilot/docs/LocalDevelopmentSetup.md)
```

Set `VITE_API_BASE_URL=http://localhost:8000` in `frontend/.env` if the API is not proxied.

## Backend tests

```bash
cd backend
.venv\Scripts\activate
pytest tests/ -v
```

## Key services (backend)

| Service | File | Role |
|---------|------|------|
| Resume parsing | `app/services/resume_parser.py` | Azure Doc Intelligence + structured OpenAI parse |
| JD analysis | `app/services/job_analyzer.py` | Extract editable requirements |
| Matching | `app/services/candidate_matcher.py` | 3-signal ranking |
| Copilot agent | `app/services/copilot_agent.py` | Bounded tool-using recruiter copilot |
| ATS benchmark | `app/services/ats_benchmark_service.py` | Keyword baseline vs LLM semantic |

See [ai-architecture.md](ai-architecture.md) for the full AI design.
