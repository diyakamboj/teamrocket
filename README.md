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
| `frontend` | Recruiter UI (dashboard, upload, ranking, compare, AI interview scheduling, copilot panel) |
| `backend` | FastAPI: resume parsing, jobs, ranking, evaluation, AI interview scheduling (Teams & Outlook), dashboard + **chat BFF** |

| `copilot` | Microsoft CWYD RAG chatbot (`POST /api/conversation`) |

## Documentation for Developers & AI Assistants

Full technical and product documentation lives in the [`docs/`](docs/) directory:

- 🤖 **[AI Assistant Technical Guide & Repository Map](docs/ai-context.md)**: Dedicated context guide for AI coding assistants (Store facade access, service map, API directory, testing rules).
- 📋 **[Product Requirements & Feature Specifications](docs/product-requirements-and-features.md)**: Complete PM specification covering all MVP, Level 1, and Level 2 features.
- 🧠 **[AI Architecture & Engine Specs](docs/ai-architecture.md)**: AI seams, provider interfaces, 3-signal scoring engine, Copilot tools, and prompt schemas.
- 🏗️ **[System Architecture](docs/architecture.md)**: System layout, service boundaries, and data persistence design.
- 🛠️ **[Development Guide](docs/development.md)**: Local setup, mock vs Azure modes, test execution (`pytest`), and Vite builds.

## How the chatbot is connected


```text
frontend (Copilot panel) / external clients
        │  POST /api/agent  (or POST /api/agent/ask)
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

Structured data (candidates, jobs, evaluations, ...) is stored as JSON
documents via the blob store — no database to set up. In mock mode
(`USE_MOCK_AZURE=true`, the default) it writes to `backend/uploads/documents/`
on local disk; pointing it at real Azure Blob Storage is a config change, not
a schema migration.

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
```

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
