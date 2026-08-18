# ResumeIQ — Full Stack

AI-powered Resume Screening Assistant with a Recruiter Copilot chatbot.

## Project structure

```text
quadrant final poject/
├── frontend/    # Recruiter UI (ResumeIQ) — port 8080
├── backend/     # Screening API + Chat BFF — port 8000
└── copilot/     # RAG Chatbot service (Microsoft CWYD) — port 8001
```

| Folder | Role |
|--------|------|
| `frontend` | Recruiter UI (dashboard, upload, ranking, compare, copilot panel) |
| `backend` | FastAPI: resume parsing, jobs, ranking, evaluation, dashboard + **chat BFF** |
| `copilot` | Microsoft CWYD RAG chatbot (`POST /api/conversation`) |

## How the chatbot is connected

```text
frontend (Copilot panel)
        │  POST /api/agent/ask
        ▼
backend (screening + BFF)
        │  enriches query with ranked candidates / job requirements
        │  POST /api/conversation  (when CHATBOT_ENABLED=true)
        ▼
copilot (RAG answers + citations)
        │
        └── fallback → local recruiter agent (mock/OpenAI) if copilot is down
```

## Quick start (from repo root)

```bash
# Frontend deps (from project root)
npm install
npm run dev          # → http://localhost:8080

# In another terminal — screening API
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Default local DB is **SQLite** (`backend/resume_assistant.db`) — no Docker required.

### Optional: Postgres

```bash
cd backend
docker compose up -d
# then set DATABASE_URL=postgresql://resume:resume@localhost:5432/resume_assistant in backend/.env
alembic upgrade head
```

### Screening API only

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

### 3) Copilot service (port 8001)

Configure the copilot using its own docs (`copilot/docs/LocalDevelopmentSetup.md`), then run its FastAPI backend on **8001**:

```bash
cd copilot
# after its .env / az login / deps are ready:
uvicorn backend.app:app --reload --host 0.0.0.0 --port 8001 --app-dir src
```

Their default docker compose uses port 8000 — either change that publish port to `8001:8000`, or keep copilot on 8000 and move the screening API to another port (and update frontend `VITE_API_BASE_URL`).

If copilot is not running, the Copilot panel still works via the **local** screening agent.

### 4) Frontend (port 8080)

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_BASE_URL=http://localhost:8000
npm run dev
```

Open [http://localhost:8080](http://localhost:8080) and use the floating **Recruiter Copilot**.

## Dev scripts

```bash
scripts/dev-frontend.sh   # frontend — port 8080
scripts/dev-screening.sh  # backend  — port 8000
scripts/dev-copilot.sh    # copilot  — port 8001
scripts/demo-up.sh        # isolated demo API (no --reload)
scripts/verify-demo.sh    # pre-talk checklist
```

Walkthrough: `demo/DEMO_SCRIPT.md`.

## Useful URLs

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| Screening API docs | http://localhost:8000/docs |
| Agent status | http://localhost:8000/api/agent/status |
| Copilot chatbot | http://localhost:8001/docs |

## Environment wiring

**Frontend** (`frontend/.env`):

```env
VITE_API_BASE_URL=http://localhost:8000
VITE_RECRUITER_EMAIL=recruiter@example.com
```

**Screening backend** (`backend/.env`):

```env
CHATBOT_API_URL=http://localhost:8001
CHATBOT_ENABLED=true
USE_MOCK_AZURE=true
```

## Smoke test the connection

1. Start `backend` on 8000.
2. Open frontend → click Copilot → ask “Compare the top 3 candidates”.
3. Check `GET http://localhost:8000/api/agent/status`:
   - `chatbot.reachable: true` when copilot is up
   - otherwise Copilot uses `source: "local"`
