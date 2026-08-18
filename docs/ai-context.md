# ResumeIQ — AI Assistant Technical Guide & Repository Map

> **Purpose:** This document is designed specifically for AI coding assistants (Google Antigravity, Claude, Copilot) to instantly understand the ResumeIQ codebase architecture, store patterns, API boundaries, service layers, and implementation conventions.

---

## 1. Quick Repository Map & File Paths

### Monorepo Structure
- **Frontend (`frontend/`)**: TanStack Start / React / Vite web app running on `http://localhost:8080`.
- **Backend (`backend/`)**: FastAPI server running on `http://localhost:8000`.
- **Copilot (`copilot/`)**: Optional standalone RAG service on `http://localhost:8001`.

### Backend Service Map (`backend/app/services/`)
| Feature Area | File Path | Core Functionality |
|---|---|---|
| **Resume Parsing** | [`backend/app/services/resume_parser.py`](file:///d:/github/teamrocket/backend/app/services/resume_parser.py) | Azure AI Document Intelligence OCR + Azure OpenAI structured parsing |
| **JD Requirement Extraction** | [`backend/app/services/job_analyzer.py`](file:///d:/github/teamrocket/backend/app/services/job_analyzer.py) | Requirement extraction & recruiter-editable criteria |
| **Candidate Matcher & Scoring** | [`backend/app/services/candidate_matcher.py`](file:///d:/github/teamrocket/backend/app/services/candidate_matcher.py) | 3-signal matching engine (keyword + semantic embeddings + LLM fit) |
| **Recruiter Copilot Agent** | [`backend/app/services/copilot_agent.py`](file:///d:/github/teamrocket/backend/app/services/copilot_agent.py) | Bounded tool-calling agent (`query_candidates`, NL scheduling) |
| **AI Interview Availability** | [`backend/app/services/calendar_service.py`](file:///d:/github/teamrocket/backend/app/services/calendar_service.py) | Overlapping schedule search, Teams link builder, Outlook .ics |
| **Interview Lifecycle** | [`backend/app/services/scheduling_service.py`](file:///d:/github/teamrocket/backend/app/services/scheduling_service.py) | Proposals, booking confirmation, rescheduling, cancellation |
| **Visual Badges & Flags** | [`backend/app/services/badge_service.py`](file:///d:/github/teamrocket/backend/app/services/badge_service.py) | Status flags (🟢 Top Match, 👥 Bench, 🚀 Immediate, ⚠️ Incomplete) |
| **L1 Preliminary Screening** | [`backend/app/services/screening_service.py`](file:///d:/github/teamrocket/backend/app/services/screening_service.py) | Screening Q&A generation, rubric evaluation, summary packs |
| **JD Calibration** | [`backend/app/services/jd_optimizer.py`](file:///d:/github/teamrocket/backend/app/services/jd_optimizer.py) | Requirement coverage analysis (`too_strict`, `low_signal`, `balanced`) |
| **ATS Benchmark Baseline** | [`backend/app/services/ats_benchmark_service.py`](file:///d:/github/teamrocket/backend/app/services/ats_benchmark_service.py) | Keyword baseline score vs LLM semantic scoring delta |
| **Fraud & Timeline Check** | [`backend/app/services/resume_consistency_service.py`](file:///d:/github/teamrocket/backend/app/services/resume_consistency_service.py) | Overlapping date gaps, fluffing anomaly detection |
| **Interviewer Handoff** | [`backend/app/services/handoff_service.py`](file:///d:/github/teamrocket/backend/app/services/handoff_service.py) | Handoff briefing packs & candidate history event logging |
| **Internal Talent Mobility** | [`backend/app/services/internal_marketplace_service.py`](file:///d:/github/teamrocket/backend/app/services/internal_marketplace_service.py) | Bench candidate auto-matching for open internal positions |
| **Profile Enrichment** | [`backend/app/services/profile_enrichment_service.py`](file:///d:/github/teamrocket/backend/app/services/profile_enrichment_service.py) | External profile link detection (GitHub, LinkedIn, HackerRank, Portfolio), GitHub REST retrieval, source attribution |
| **Readiness & Assessment** | [`backend/app/services/readiness_service.py`](file:///d:/github/teamrocket/backend/app/services/readiness_service.py) | Aptitude & readiness criteria evaluation, explainable recommendations, recruiter approval, score tracking |
| **Evidence Line Tracking** | [`backend/app/services/evidence_tracker.py`](file:///d:/github/teamrocket/backend/app/services/evidence_tracker.py) | Snippet extraction quoting exact resume text for scores |



---

## 2. Data Persistence Strategy (`Store` Facade)

ResumeIQ uses an asynchronous **`JsonBlobStore` & `Store` facade architecture** defined in [`backend/app/storage/store.py`](file:///d:/github/teamrocket/backend/app/storage/store.py).

### How Store Access Works
All FastAPI route handlers inject `store: AppStore` (which resolves to `Store` dependency). **Do not use SQL/ORM sessions.**

```python
# Accessing repositories via Store facade
candidate = store.candidates.get(candidate_id)        # Get single entity by UUID
all_candidates = store.candidates.list_all()           # List all entities in collection
store.candidates.save(candidate)                       # Persist Pydantic model object
store.candidates.delete(candidate_id)                  # Delete entity
```

### Store Repository Catalog
- `store.candidates`: `Repository[Candidate]` -> `"candidates"`
- `store.jobs`: `Repository[JobPosting]` -> `"job_postings"`
- `store.evaluations`: `EvaluationRepository` -> `"evaluations"`
- `store.evidence`: `EvidenceRepository` -> `"evidence"`
- `store.audit_logs`: `AppendOnlyRepository[AuditLog]` -> `"audit_logs"`
- `store.agent_sessions`: `Repository[AgentSession]` -> `"agent_sessions"`
- `store.handoffs`: `Repository[InterviewHandoff]` -> `"interview_handoffs"`
- `store.interviews`: `Repository[ScheduledInterview]` -> `"scheduled_interviews"`
- `store.screening_sessions`: `Repository[ScreeningSession]` -> `"screening_sessions"`
- `store.ats_benchmarks`: `AtsBenchmarkRepository` -> `"ats_benchmarks"`

---

## 3. Core Architectural Rules for AI Assistants

1. **Always Use `Store` for Persistence**: Domain entities inherit from Pydantic `BaseModel`. Read and write data exclusively through `store.<collection>`.
2. **Preserve Graceful AI Degradation**: When Azure credentials (`USE_MOCK_AZURE=true`) are not set, all AI services must seamlessly fall back to deterministic mock or regex logic.
3. **Never Swallow Errors**: Always catch errors explicitly and log them via `get_logger(__name__)` or raise `ValidationAppError` / `NotFoundError` from `app.utils.error_handlers`.
4. **Maintain Evidence Provenance**: Every score, verdict, or badge generated by AI must include traceable evidence quoting candidate resume text or profile data.
5. **Enforce Recruiter Context (`X-Recruiter-Email`)**: Endpoint handlers should consume `recruiter_email: RecruiterEmail` dependency to log audit events (`store.audit_logs.save(...)`).
6. **Frontend Component Architecture**: UI components in `frontend/src/components/` use Vanilla CSS / Tailwind + Radix UI primitives. Render interactive cards in Copilot using `frontend/src/components/copilot/structured/result-renderer.tsx`.

---

## 4. API Directory (`backend/app/routes/`)

- [`agent.py`](file:///d:/github/teamrocket/backend/app/routes/agent.py): `POST /api/agent` (Public Agent API), `POST /api/agent/ask`, `GET /api/agent/sessions`.
- [`candidates.py`](file:///d:/github/teamrocket/backend/app/routes/candidates.py): `GET /api/candidates/rank`, `GET /api/candidates/{id}/score`, `GET /api/candidates/{id}/badges`, `POST /api/candidates/{id}/enrich`.
- [`interviews.py`](file:///d:/github/teamrocket/backend/app/routes/interviews.py): `GET /api/interviews/interviewers`, `POST /api/interviews/propose`, `POST /api/interviews/confirm`, `POST /api/interviews/{id}/reschedule-propose`, `POST /api/interviews/{id}/reschedule-confirm`, `POST /api/interviews/{id}/cancel`.
- [`screening.py`](file:///d:/github/teamrocket/backend/app/routes/screening.py): `POST /api/screening/session`, `POST /api/screening/answer`, `GET /api/screening/candidate/{id}`.
- [`jobs.py`](file:///d:/github/teamrocket/backend/app/routes/jobs.py): `POST /api/jobs`, `POST /api/jobs/{id}/analyze`, `GET /api/jobs/{id}/optimization`.
- [`evaluation.py`](file:///d:/github/teamrocket/backend/app/routes/evaluation.py): `POST /api/evaluation/compare`, `GET /api/evaluation/{id}/evidence`.
- [`fraud.py`](file:///d:/github/teamrocket/backend/app/routes/fraud.py): `GET /api/fraud/check/{candidate_id}`.
- [`handoff.py`](file:///d:/github/teamrocket/backend/app/routes/handoff.py): `POST /api/handoff`, `GET /api/handoff/{id}`, `POST /api/handoff/{id}/acknowledge`.
- [`internal_marketplace.py`](file:///d:/github/teamrocket/backend/app/routes/internal_marketplace.py): `GET /api/internal-marketplace/recommendations`.

---

## 5. Verification Commands

When adding features or modifying code, run these exact commands to verify correctness:

```bash
# Backend pytest suite (must pass 100%)
cd backend
python -m pytest -v

# Frontend production build & typecheck (must succeed cleanly)
cd frontend
npm run build
```
