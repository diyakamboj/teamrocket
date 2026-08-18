# ResumeIQ Backend — Architectural Overview & Developer Guide

This document provides an in-depth technical overview of the **ResumeIQ Backend**. It explains the Python FastAPI architecture, service layer patterns, facade storage layer, AI engine integrations, and test suite.

---

## 1. Core Technology Stack

- **Language & Runtime**: [Python 3.12](https://www.python.org/)
- **API Framework**: [FastAPI 0.109](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/)
- **Data Validation & Settings**: [Pydantic v2](https://docs.pydantic.dev/) + `pydantic-settings`
- **Cloud & AI Clients**:
  - `azure-ai-documentintelligence` (OCR Resume Parsing)
  - `openai` & `azure-identity` (Azure OpenAI GPT-4o & Text Embeddings)
  - `azure-search-documents` (Semantic Vector Overlap)
  - `azure-storage-blob` (Document Storage)
- **Testing**: [Pytest](https://docs.pytest.org/) + `pytest-asyncio` (48+ unit & integration test modules)

---

## 2. Facade Repository Pattern (`JsonBlobStore`)

A key architectural design choice of ResumeIQ is its **zero-database dependency model**:

```text
FastAPI Routes / Services
       │
       ▼
  Store (AppStore Facade)
       │
       ├── store.candidates              -> Repository[Candidate]
       ├── store.job_postings            -> Repository[JobPosting]
       ├── store.evaluations             -> Repository[Evaluation]
       ├── store.interview_handoffs      -> Repository[InterviewHandoff]
       ├── store.scheduled_interviews    -> Repository[ScheduledInterview]
       └── store.audit_logs              -> Repository[AuditLog]
       │
       ▼
  JsonBlobStore / Azure Blob Storage
  (Local disk: backend/uploads/documents/ or Azure Blob Container)
```

### Why this matters for developers:
- No PostgreSQL/MySQL database setup, migrations, or ORM overhead required.
- In local development mode (`USE_MOCK_AZURE=true`), entities persist safely to JSON documents on disk under `backend/uploads/documents/`.
- Switching to live Azure Blob Storage is a pure environment configuration change (`AZURE_STORAGE_CONNECTION_STRING`), requiring zero schema changes.

---

## 3. Directory & Backend Service Map

```text
backend/
├── app/
│   ├── main.py                  # FastAPI Application Entry Point & CORS Setup
│   ├── config.py                # Pydantic Settings & Environment Variable Loader
│   ├── dependencies.py          # AppStore Dependency Injection & Recruiter Email Headers
│   ├── models/                  # Pydantic Data Models & Schemas
│   │   ├── candidate.py              # Candidate & Profile Schemas
│   │   ├── evaluation.py             # Evaluations, Audits, Decisions, Resumes
│   │   ├── handoff.py                # Interview Handoff Briefings & History Events
│   │   ├── screening.py              # Screening Sessions & Questions
│   │   └── schemas.py                # Job, Ranking, WeightConfig API Payloads
│   ├── routes/                  # REST API Route Handlers
│   │   ├── resumes.py                # POST /api/resumes/upload & parsing
│   │   ├── candidates.py             # GET /api/candidates, rank, enrich, decision
│   │   ├── jobs.py                   # GET/POST /api/jobs management
│   │   ├── agent.py                  # POST /api/agent/ask Recruiter Copilot BFF
│   │   ├── interviews.py             # Propose, confirm, Teams link generation
│   │   ├── handoff.py                # Interviewer briefing handoff creation & view
│   │   ├── readiness.py              # Candidate readiness assessment triggers
│   │   ├── ats_benchmark.py          # Keyword vs Semantic ATS benchmarks
│   │   ├── fraud_detection.py        # Resume timeline consistency verification
│   │   └── internal_marketplace.py   # Internal talent mobility matching
│   └── services/                # Core AI Engines & Business Logic
│       ├── resume_parser.py          # Document Intelligence OCR & LLM JSON extraction
│       ├── candidate_matcher.py      # 3-Signal Match Engine (skills, experience, education)
│       ├── copilot_agent.py          # Natural language Copilot agent query parser
│       ├── interview_service.py      # Teams meeting link generation & Outlook deep-links
│       ├── handoff_service.py        # Interview briefing formatting & history logging
│       ├── profile_enrichment_service.py # GitHub REST API scraper & repository analyzer
│       ├── ats_benchmark_service.py  # Keyword vs Vector embedding match deltas
│       ├── readiness_service.py      # Skill gap probe assessment engine
│       ├── resume_consistency.py     # Date overlap & inflated title fraud detector
│       └── azure_services.py         # Azure OpenAI, Document Intelligence, Search wrappers
├── tests/                       # Complete Pytest test suite (77 assertions)
├── requirements.txt             # Python package dependencies
└── .env.example                 # Environment configuration template
```

---

## 4. Key AI Engines & Business Logic Services

### 1. Resume Parsing Engine (`resume_parser.py`)
- Downloads uploaded file bytes (`.pdf`, `.docx`, `.txt`).
- Invokes Azure Document Intelligence OCR (`doc_intelligence_service.extract_text`), with local PDF text extraction fallback when API keys are unconfigured.
- Passes extracted text to Azure OpenAI GPT-4o with `RESUME_SYSTEM_PROMPT` (`temperature=0`) to extract candidate contact info, work experience, education, certifications, and skills.
- Upserts the candidate into `store.candidates`.

### 2. 3-Signal Candidate Matching Engine (`candidate_matcher.py`)
Ranks candidates against a target Job Posting using configurable category weights:
- **Skill Overlap Signal** (Weight: 40% default): Calculates skill badge matches and Azure AI Search vector semantic embeddings.
- **Experience Alignment Signal** (Weight: 30% default): Compares candidate years of experience against job seniority requirement.
- **Education & Project Signal** (Weight: 30% default): Evaluates degree field relevance and project highlights.
- Supports **Blind Review Mode** (`blind_mode=true`): Dynamically redacts candidate names, emails, and phone numbers to eliminate hiring bias.

### 3. Automated Interview Scheduling & Handoff (`interview_service.py` & `handoff_service.py`)
- Generates MS Teams meeting links (`https://teams.microsoft.com/l/meetup-join/...`) and Outlook web calendar deeplinks for proposed interview slots.
- Builds structured **Interviewer Briefing Handoffs** containing candidate scorecards, key strengths, and suggested gap-probing interview questions.
- Logs full event history (`evaluation_created`, `decision_approved`, `handoff_sent`) to `store.candidate_history_events`.

---

## 5. Local Setup & Testing

### Running the Backend Server
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Running Test Suite
```bash
# From backend directory
.venv/bin/pytest -v
```
- Includes 48+ test files covering agent routing, resume parsing, candidate scoring, interview scheduling, handoffs, and fraud detection.
