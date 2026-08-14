# ResumeIQ Documentation (phase-1)

Architecture and AI design docs for the **phase-1** branch. This branch uses the **high-priority-features** monorepo layout:

```text
teamrocket/
├── frontend/     # Recruiter UI (TanStack Start) — port 8080
├── backend/      # FastAPI screening API + copilot agent — port 8000
├── copilot/      # Optional CWYD RAG chatbot — port 8001
└── docs/         # This folder
```

## Docs in this folder

| File | Description |
|------|-------------|
| [ai-architecture.md](ai-architecture.md) | AI seams, 3-signal scoring, copilot agent design |
| [architecture.md](architecture.md) | Target system architecture and service boundaries |
| [development.md](development.md) | Local development setup |
| [deployment.md](deployment.md) | Deployment and ops notes |

## phase-1 integration notes

- **AI pipeline** lives in `backend/app/services/` (Python), ported from `parsing-feature` (`src/lib/server/`).
- **Copilot agent** is `backend/app/services/copilot_agent.py` — bounded two-step tool-using agent with deterministic fallback.
- **3-signal matching** (keyword + semantic embeddings + AI explanation) is in `matching_signals.py` and `candidate_matcher.py`.
- **CWYD** (`copilot/`) remains an optional RAG layer; the local agent is the primary path.
