# ResumeIQ — Project Progress & Milestone Summary

**Sprint Branch:** `phase-2`  
**Last Updated:** August 2026  
**Status:** All MVP, Level 1 High Priority, Level 2 Medium Priority, and Aptitude & Readiness features implemented, merged, and verified.

---

## 1. Executive Overview

ResumeIQ has progressed from initial architectural design to a fully operational, enterprise-grade candidate screening, profile enrichment, readiness assessment, and interview coordination platform. The project is unified on the **`phase-2`** branch under an asynchronous **`JsonBlobStore` repository pattern**, backed by a Python FastAPI backend and a TanStack Start / React frontend.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                SYSTEM VERIFICATION STATUS                               │
├───────────────────────────────────┬─────────────────────────────────────────────────────┤
│ Backend Test Suite                │ 41 / 41 Tests Passing (100% clean pytest output)    │
│ Frontend Production Build         │ Built in 8.35s with 0 errors (Client + SSR bundles) │
│ Persistence Layer                 │ Store facade over JsonBlobStore                     │
│ Active Branch                     │ phase-2 (merged with readiness & enrichment)        │
└───────────────────────────────────┴─────────────────────────────────────────────────────┘
```

---

## 2. Frontend Progress (`frontend/`)

Built using **TanStack Start**, **React**, **Vite**, **TailwindCSS**, and **Radix UI** primitives.

### Core Views & Components Implemented
- 📄 **Candidate Drawer & Ranking List** ([`routes/candidates.tsx`](file:///d:/github/teamrocket/frontend/src/routes/candidates.tsx)):
  - Real-time candidate ranking table with interactive slider weights (`skills`, `experience`, `education`, `certifications`, `projects`).
  - 1-click **Blind Review Mode** toggle for PII redaction.
  - Expanded candidate drawer embedding interview scheduling, preliminary screening, visual status badges, public profile enrichment, and aptitude readiness cards.
- 📋 **Aptitude & Readiness Notification Workflow** ([`components/candidate-readiness-card.tsx`](file:///d:/github/teamrocket/frontend/src/components/candidate-readiness-card.tsx)):
  - AI readiness recommendations detailing target competencies and gap triggers.
  - Recruiter governance controls ("Approve & Send Assessment").
  - Assessment status history tracking and completion score submission.
- 🌐 **External Profile Signals & Repository Drawer** ([`components/candidate-enrichment-card.tsx`](file:///d:/github/teamrocket/frontend/src/components/candidate-enrichment-card.tsx)):
  - Public profile links (GitHub, LinkedIn, HackerRank, Portfolio).
  - Top GitHub repository cards with star counts, primary languages, and live links.
  - Verified external skills with source attribution tags (`github`, `linkedin`, `hackerrank`, `portfolio`).
- 📊 **Side-by-Side Candidate Comparison Matrix** ([`routes/compare.tsx`](file:///d:/github/teamrocket/frontend/src/routes/compare.tsx)):
  - Multi-column comparative matrix detailing category scores, skill overlap, missing skills, and role fit recommendations.
- 📅 **AI Interview Scheduling Section** ([`components/interview-card.tsx`](file:///d:/github/teamrocket/frontend/src/components/interview-card.tsx)):
  - Slot selection grid with interviewer availability indicators.
  - Direct 1-click booking confirmation with auto-generated **Microsoft Teams** join buttons and **Outlook** calendar invitations (`.ics` / web deeplinks).
- 🏷️ **Candidate Visual Status Badges** ([`components/candidate-badges.tsx`](file:///d:/github/teamrocket/frontend/src/components/candidate-badges.tsx)):
  - **Status Flags**: 🟢 Top Match, 👥 Bench Candidate, 🚀 Immediate Joiner, ⚠️ Incomplete Profile.
  - **Verified Skill Chips**: Skills corroborated by resume evidence snippets or linked public profiles.
- 💬 **Conversational Preliminary Screening (L1)** ([`components/screening.tsx`](file:///d:/github/teamrocket/frontend/src/components/screening.tsx), [`routes/screening.tsx`](file:///d:/github/teamrocket/frontend/src/routes/screening.tsx)):
  - Technical screening Q&A interface and pre-interview summary pack generation.
- 🤖 **Recruiter Copilot Chat Panel** ([`components/copilot.tsx`](file:///d:/github/teamrocket/frontend/src/components/copilot.tsx)):
  - Floating AI assistant panel rendering structured React response cards (`candidate_card`, `comparison_table`, `must_have_report`, `interview_proposal`).
- 📈 **Dashboard Insights & Analytics** ([`routes/insights.tsx`](file:///d:/github/teamrocket/frontend/src/routes/insights.tsx)):
  - Top-level hiring metrics, score distribution histograms, and stage counts.
- 🎯 **ATS Benchmark Baseline Scoring** ([`routes/ats-benchmark/index.tsx`](file:///d:/github/teamrocket/frontend/src/routes/ats-benchmark/index.tsx)):
  - Comparison matrix matching strict ATS keyword scores against LLM semantic fit.
- 🛡️ **Resume Fraud & Anomaly Detection Panel** ([`routes/fraud-detection.tsx`](file:///d:/github/teamrocket/frontend/src/routes/fraud-detection.tsx)):
  - Employment timeline verification, overlapping job date checking, and fluffing risk ratings (`low`, `medium`, `high`).
- 📋 **Technical Interview Handoff Briefings** ([`routes/handoff/$handoffId.tsx`](file:///d:/github/teamrocket/frontend/src/routes/handoff/$handoffId.tsx)):
  - Technical briefing notes for interview loops with view & acknowledge status tracking.

---

## 3. Backend Progress (`backend/`)

Built using **Python 3.12**, **FastAPI**, **Pydantic v2**, and the **`Store` repository pattern** over `JsonBlobStore`.

### 15 Key Services Implemented (`backend/app/services/`)
1. 📋 **`readiness_service.py`**: Aptitude & readiness criteria evaluation, transparent AI recommendation generation, recruiter approval workflow ("Approve & Send"), and score results integration.
2. 🌐 **`profile_enrichment_service.py`**: External link extraction (GitHub, LinkedIn, HackerRank, Portfolio), GitHub REST API integration (using `GITHUB_TOKEN`), data normalization, and source attribution.
3. 📄 **`resume_parser.py`**: Azure AI Document Intelligence OCR parsing + Azure OpenAI structured JSON extraction with regex fallback engine.
4. 📝 **`job_analyzer.py`**: Automated job description requirement extraction and recruiter criteria editing.
5. 🎯 **`candidate_matcher.py`**: 3-signal matching engine combining keyword scoring, semantic embeddings, and LLM qualitative analysis.
6. 🤖 **`copilot_agent.py`**: Bounded 2-step tool-calling agent with structured card output generation.
7. 📅 **`calendar_service.py`**: Overlapping interviewer schedule calculator, Microsoft Teams meeting link builder, and Outlook `.ics` string builder.
8. ⚙️ **`scheduling_service.py`**: Interview proposals, booking confirmation, rescheduling, cancellation, and candidate history logging.
9. 🏷️ **`badge_service.py`**: Candidate status flag rules (Top Match, Bench Candidate, Immediate Joiner, Incomplete Profile) and verified skill badge compilation.
10. 💬 **`screening_service.py`**: L1 preliminary screening question generation, candidate answer evaluation, and pre-interview summary pack synthesis.
11. 📊 **`jd_optimizer.py`**: Requirement coverage analysis classifying criteria into `too_strict`, `low_signal`, `under_filtered`, or `balanced`.
12. 📐 **`ats_benchmark_service.py`**: Keyword baseline score vs LLM semantic evaluation delta calculation.
13. 🛡️ **`resume_consistency_service.py`**: Automated timeline gap checking and resume inflation anomaly detection.
14. 📋 **`handoff_service.py`**: Interviewer briefing notes generation, email notifications, and candidate history event logging.
15. 👥 **`internal_marketplace_service.py`**: Internal bench candidate auto-matching and talent mobility recommendations.

### 29 REST Endpoints Implemented (`backend/app/routes/`)
- **Readiness & Assessment**: `GET /api/readiness/evaluate/{candidate_id}`, `POST /api/readiness/trigger`, `POST /api/readiness/{assessment_id}/results`, `GET /api/readiness/candidate/{candidate_id}`.
- **Agent**: `POST /api/agent` (Public Agent API), `POST /api/agent/ask`, `GET /api/agent/sessions`.
- **Candidates**: `GET /api/candidates/rank`, `GET /api/candidates/{id}/score`, `GET /api/candidates/{id}/badges`, `POST /api/candidates/{id}/enrich`.
- **Interviews**: `GET /api/interviews/interviewers`, `POST /api/interviews/propose`, `POST /api/interviews/confirm`, `POST /api/interviews/{id}/reschedule-propose`, `POST /api/interviews/{id}/reschedule-confirm`, `POST /api/interviews/{id}/cancel`.
- **Screening**: `POST /api/screening/session`, `POST /api/screening/answer`, `GET /api/screening/candidate/{id}`.
- **Jobs**: `POST /api/jobs`, `POST /api/jobs/{id}/analyze`, `GET /api/jobs/{id}/optimization`.
- **Evaluation**: `POST /api/evaluation/compare`, `GET /api/evaluation/{id}/evidence`.
- **Fraud**: `GET /api/fraud/check/{candidate_id}`.
- **Handoff**: `POST /api/handoff`, `GET /api/handoff/{id}`, `POST /api/handoff/{id}/acknowledge`.
- **Internal Talent Marketplace**: `GET /api/internal-marketplace/recommendations`.

---

## 4. AI & Intelligence Progress

1. **Three-Signal Scoring Engine**:
   - *Keyword Signal*: Standard token matching with section weighting.
   - *Semantic Embedding Signal*: Cosine similarity using text embeddings.
   - *LLM Signal*: Qualitative strength/gap analysis.
2. **Bounded Tool-Calling Agent Architecture**:
   - Registered 8 tools: `search_candidates`, `get_verdicts`, `compare`, `gap_summary`, `must_have_report`, `schedule_interview`, `get_enriched_profile`, `check_readiness`.
   - Guaranteed evidence provenance without hallucinated citations.
3. **Public HTTP Agent API Endpoint (`POST /api/agent`)**:
   - Exposes agent capabilities to external applications with flexible JSON inputs (`"query"` or `"question"`).
4. **Graceful Fallback & Mock Mode (`USE_MOCK_AZURE=true`)**:
   - 100% of features run locally without live Azure credentials or external dependencies.

---

## 5. Next Milestones & Roadmap

- [ ] **Live Azure Deployment**: Deploy FastAPI backend to Azure App Service and TanStack Start frontend to Azure Static Web Apps / Vercel.
- [ ] **Live Microsoft Graph OAuth**: Connect live Microsoft Graph API credentials for live Outlook calendar syncing.
- [ ] **Real-time Voice Screening**: Expand Copilot panel with live WebSockets voice screening using Gemini/OpenAI Live API.
