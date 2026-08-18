# ResumeIQ — Development Guide (`phase-2`)

How to set up and run the **`phase-2`** monorepo locally.

## Prerequisites

- Node 20+ and npm
- Python 3.11+ (Python 3.12 supported)
- Optional: Azure credentials for live AI (otherwise `USE_MOCK_AZURE=true` in `backend/.env`)

## Project layout

```text
frontend/    # Recruiter UI — http://localhost:8080
backend/     # FastAPI API — http://localhost:8000
copilot/     # Optional CWYD RAG service — http://localhost:8001
docs/        # System Architecture & PM Specifications
```

## Quick start

```bash
# From repo root
npm install

# Terminal 1 — frontend (Vite dev server)
npm run dev

# Terminal 2 — backend (FastAPI dev server)
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows (PowerShell / CMD)
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Optional Terminal 3 — CWYD copilot (see copilot/docs/LocalDevelopmentSetup.md)
```

Set `VITE_API_BASE_URL=http://localhost:8000` in `frontend/.env` if the API is not proxied.

## Automated Verification & Testing

```bash
# Run backend pytest suite (36 tests)
cd backend
python -m pytest -v

# Run frontend production build & typecheck
cd frontend
npm run build
```

## Key Backend Services (`backend/app/services/`)

| Service | File | Role |
|---|---|---|
| **Resume Parsing** | `app/services/resume_parser.py` | Azure Doc Intelligence OCR + structured OpenAI parse |
| **JD Analysis** | `app/services/job_analyzer.py` | Requirement extraction & editable criteria |
| **Candidate Matcher** | `app/services/candidate_matcher.py` | 3-signal scoring & dynamic category weight calculation |
| **Copilot Agent** | `app/services/copilot_agent.py` | Bounded tool-using recruiter copilot & NL scheduling |
| **Public Agent API** | `app/routes/agent.py` | Public `POST /api/agent` HTTP endpoint |
| **ATS Benchmark** | `app/services/ats_benchmark_service.py` | Keyword baseline vs LLM semantic evaluation layer |
| **AI Calendar Availability** | `app/services/calendar_service.py` | Interviewer schedule calculator & Teams link generator |
| **Interview Scheduling** | `app/services/scheduling_service.py` | Proposals, booking confirmation, rescheduling, cancellation |
| **Visual Badges Engine** | `app/services/badge_service.py` | Top Match, Bench Candidate, Immediate Joiner, Verified Skills |
| **Preliminary Screening** | `app/services/screening_service.py` | L1 screening Q&A generator, answer rubric scoring, summary packs |
| **JD Calibration** | `app/services/jd_optimizer.py` | Requirement coverage analysis (`too_strict`, `low_signal`, `balanced`) |
| **Fraud Detection** | `app/services/resume_consistency_service.py` | Employment timeline verification & fluffing anomaly detection |
| **Handoff Briefings** | `app/services/handoff_service.py` | Interviewer summary briefings & candidate history logging |

See [product-requirements-and-features.md](product-requirements-and-features.md) for full PM feature specifications and [ai-architecture.md](ai-architecture.md) for AI engine details.

