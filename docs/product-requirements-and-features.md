# ResumeIQ — Product Requirements & Feature Catalog

**Document Version:** 2.0 (`phase-2` Sprint Release)  
**Author:** Senior Product Management & Engineering Team  
**Status:** Approved & Implemented  

---

## 1. Executive Summary & Vision

Recruiting teams spend up to 60% of their time manually screening resumes, cross-referencing candidate qualifications against vague job descriptions, and manually coordinating interview logistics. Standard Applicant Tracking Systems (ATS) rely on brittle, exact-keyword matching that rejects qualified candidates with non-identical terminology while missing resume inflation and fraud.

**ResumeIQ** is an enterprise-grade, AI-powered candidate screening and interview coordination platform. It combines deterministic keyword parsing, LLM semantic evaluation, multi-signal evidence tracing, bias-free blind review, automated interview scheduling, and visual skill verification into a seamless recruiter interface.

---

## 2. Target User Personas

| Persona | Primary Goal | Pain Points Solved |
|---|---|---|
| **Technical Recruiter** | Rapidly shortlist top-fit candidates for open headcount. | Eliminates manual resume scanning, manual calendar checking, and keyword-only filtering. |
| **Hiring Manager** | Compare top candidates and calibrate JD requirements. | Provides clear side-by-side comparison matrix, requirement coverage metrics, and JD optimization suggestions. |
| **Technical Interviewer** | Conduct focused technical interviews with full candidate context. | Receives comprehensive handoff briefings, pre-interview summary packs, and verified skill evidence. |
| **Talent Ops / VP of HR** | Ensure unbiased hiring practices, internal bench mobility, and audit logging. | Offers 1-click blind review mode, internal bench employee auto-matching, and complete audit logging. |

---

## 3. Complete Feature Catalog & Requirement Matrix

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   RESUMEIQ FEATURE MATRIX                               │
├──────────────────────────────┬───────────────────────────────┬─────────────────────────┤
│          MVP (Core)          │     LEVEL 1 (High Priority)   │  LEVEL 2 (Med Priority) │
├──────────────────────────────┼───────────────────────────────┼─────────────────────────┤
│ • Bulk Resume Upload         │ • Evidence Line-by-Line       │ • Bench Auto-Matching   │
│ • AI Resume Parsing          │ • Side-by-Side Comparison     │ • AI Scheduling & MS    │
│ • JD Requirement Extraction  │ • Recruiter Copilot Agent     │ • Fraud Detection       │
│ • Candidate Matching Engine  │ • Public Agent Endpoint       │ • Visual Status Badges  │
│                              │ • Top-Level Dashboard         │ • L1 Screening Packs    │
│                              │ • Interviewer Handoff         │ • JD Calibration Analytics│
│                              │ • Dual ATS Baseline Scoring   │                         │
│                              │ • Adjustable Category Weights │                         │
│                              │ • Blind Review Mode           │                         │
└──────────────────────────────┴───────────────────────────────┴─────────────────────────┘
```

---

## 4. Module Deep Dives & Product Specifications

### 4.1 Bulk Resume Parsing & Document Intelligence
- **User Story:** As a recruiter, I want to upload a batch of 50+ resume PDFs (including scanned documents) so that structured candidate profiles are created automatically.
- **Capabilities:**
  - Asynchronous batch processing powered by Azure AI Document Intelligence (`prebuilt-read` model) for OCR.
  - LLM extraction coercing output into structured JSON (`skills`, `work_experience`, `education`, `certifications`, `projects`).
  - Regex fallback engine when LLM output is unavailable, ensuring 100% parse completion.
- **REST Endpoints:** `POST /api/resumes/upload`, `GET /api/resumes/{resume_id}`.

---

### 4.2 Job Description Analysis & AI Criteria Extraction
- **User Story:** As a hiring manager, I want to paste raw job descriptions and extract structured hiring criteria so I can review and customize requirements before screening.
- **Capabilities:**
  - Automatic extraction of `required_skills`, `nice_to_have_skills`, `required_experience_years`, `education_requirements`, and screening summaries.
  - Interactive recruiter requirement editor allowing real-time edits, MUST/NICE toggle, and skill addition/removal.
- **REST Endpoints:** `POST /api/jobs`, `POST /api/jobs/{job_id}/analyze`.

---

### 4.3 Multi-Signal Matching & Dual ATS Baseline Scoring
- **User Story:** As a recruiter, I want candidate rankings based on both strict keyword ATS baseline scoring and LLM semantic fit so that I don't miss top talent due to phrasing differences.
- **Capabilities:**
  - **3-Signal Architecture**:
    1. *Exact Keyword Score*: Standard ATS string token matching.
    2. *Semantic Embedding Score*: Cosine similarity using text embeddings.
    3. *LLM Qualitative Analysis*: Detailed strength, gap, and transferable skill evaluation.
  - **Dual ATS Baseline Framework**: Calculates keyword baseline score alongside semantic LLM score and flags score deltas to highlight hidden gems.
- **REST Endpoints:** `GET /api/candidates/rank?job_id=`, `GET /api/candidates/{id}/score?job_id=`.

---

### 4.4 Explainable Rankings & Line-by-Line Evidence Tracing
- **User Story:** As a recruiter, I want exact evidence quotes linking candidate match scores back to their resume text so that rankings are fully explainable.
- **Capabilities:**
  - Quotation extraction highlighting the exact section, role, and text snippet where a required skill or qualification was demonstrated.
  - Confidence scoring per evidence snippet.
- **REST Endpoints:** `GET /api/evaluation/{id}/evidence`.

---

### 4.5 Multi-Candidate Side-by-Side Comparison Matrix
- **User Story:** As a hiring manager, I want to compare up to 4 candidates side-by-side to evaluate relative strengths, skill gaps, and role fit recommendations.
- **Capabilities:**
  - Multi-column comparison grid with category score breakdown (Skills, Experience, Education, Certifications, Projects).
  - Highlighted skill match / missing skill matrices.
- **REST Endpoints:** `POST /api/evaluation/compare`.

---

### 4.6 Adjustable Category Weights & Dynamic Recruiter Scoring
- **User Story:** As a recruiter, I want to adjust the relative importance of scoring categories (e.g., set Skills to 50% and Experience to 30%) for specific roles.
- **Capabilities:**
  - Real-time weight adjustment interface (`skills`, `experience`, `education`, `certifications`, `projects`).
  - Instant recalculation of candidate rankings upon weight change.
- **REST Endpoints:** `GET /api/candidates/rank?job_id=&skills=0.50&experience=0.30...`.

---

### 4.7 Blind Review & Bias Mitigation Engine
- **User Story:** As a recruiter, I want 1-click candidate PII redaction during initial screening to prevent conscious or unconscious bias.
- **Capabilities:**
  - Redacts candidate names, photos, email addresses, phone numbers, and location data across ranking lists, candidate drawers, and comparisons.
  - Replaces PII with randomized candidate identifiers (e.g., "Candidate #A4F9").
- **REST Endpoints:** `POST /api/evaluation/{candidate_id}/{job_id}/blind-review`.

---

### 4.8 Bounded Recruiter AI Copilot & Public Agent API (`POST /api/agent`)
- **User Story:** As a recruiter or external application, I want a conversational AI agent to query candidate pools, explain rankings, and execute workflow commands via natural language.
- **Capabilities:**
  - **Tool-Calling Agent**: Operates with bounded tools (`search_candidates_by_skill`, `get_top_candidates`, `explain_candidate_ranking`, `schedule_interview`).
  - **Structured Result Cards**: Delivers interactive React card components in chat bubbles (`candidate_card`, `comparison_table`, `interview_proposal`).
  - **Public REST Endpoint**: `POST /api/agent` accepting `"query"` or `"question"` with optional context for third-party client integration.
- **REST Endpoints:** `POST /api/agent`, `POST /api/agent/ask`, `GET /api/agent/sessions`.

---

### 4.9 Top-Level Recruiter Dashboard & Pipeline Analytics
- **User Story:** As a talent acquisition lead, I want a bird's-eye view of active job postings, internal vs external applicant counts, and stage distribution.
- **Capabilities:**
  - Job pipeline summary metrics, score distribution histograms, and stage progression breakdown.
- **REST Endpoints:** `GET /api/dashboard/job/{job_id}/insights`, `GET /api/dashboard/job/{job_id}/distribution`.

---

### 4.10 Technical Interview Handoff & Historical Audit Logging
- **User Story:** As a recruiter, I want to generate structured interview handoff briefings and log all candidate evaluation events.
- **Capabilities:**
  - Centralized candidate history timeline logging (`candidate_history_events`).
  - Handoff briefing notes generation with view/acknowledge tracking for interviewers.
- **REST Endpoints:** `POST /api/handoff`, `GET /api/handoff/{id}`, `POST /api/handoff/{id}/acknowledge`.

---

### 4.11 Internal Talent Marketplace & Bench Auto-Matching
- **User Story:** As a VP of HR, I want the system to automatically recommend internal bench or displaced employees for open roles before sourcing externally.
- **Capabilities:**
  - Skill-matching algorithm filtering for internal candidates (`employment_status == "bench" | "internal"`).
  - Priority badge assignment and internal talent mobility tracking.
- **REST Endpoints:** `GET /api/internal-marketplace/recommendations?job_id=`.

---

### 4.12 AI-Powered Interview Scheduling & MS Ecosystem Integration
- **User Story:** As a recruiter, I want to schedule technical interviews directly from candidate profiles or via Copilot natural-language commands (*"Schedule a 45-minute technical interview with Alex and Priya next week"*).
- **Capabilities:**
  - **Calendar Availability Engine**: Matches required interviewer schedules across business days.
  - **Microsoft Teams Integration**: Auto-generates realistic Teams join URLs, conference IDs, passcodes, and dial-in bridge numbers.
  - **Microsoft Outlook Integration**: Auto-generates `.ics` calendar invitation files and Outlook web deeplinks.
  - **Lifecycle Management**: Supports slot proposals, booking confirmation, rescheduling, and cancellation with audit trail logging.
- **REST Endpoints:** `GET /api/interviews/interviewers`, `POST /api/interviews/propose`, `POST /api/interviews/confirm`, `POST /api/interviews/{id}/reschedule-propose`, `POST /api/interviews/{id}/reschedule-confirm`, `POST /api/interviews/{id}/cancel`.

---

### 4.13 Automated Resume Fraud & Timeline Verification
- **User Story:** As a recruiter, I want automated anomaly detection for missing documents, resume fluffing, or inconsistent employment timelines.
- **Capabilities:**
  - Automated timeline verification detecting overlapping dates, employment gaps > 6 months, and degree/experience discrepancies.
  - Risk rating output (`low`, `medium`, `high`) with flagged anomalies and evidence.
- **REST Endpoints:** `GET /api/fraud/check/{candidate_id}`.

---

### 4.14 Candidate Visual Status Flags & Verified Skill Badges
- **User Story:** As a recruiter, I want visual indicators on candidate profiles to quickly spot top matches, bench employees, immediate joiners, and verified skills.
- **Capabilities:**
  - **Status Flags**:
    - 🟢 **Top Match**: Overall score ≥ 80 and skill score ≥ 75.
    - 👥 **Bench Candidate**: Solid candidate (score ≥ 60) for talent pool.
    - 🚀 **Immediate Joiner**: Detected immediate availability snippet.
    - ⚠️ **Incomplete Profile**: Missing critical sections (experience, education).
  - **Verified Skill Badges**: Skills corroborated by resume snippets (confidence ≥ 70%) or linked public profiles (GitHub/LinkedIn).
- **REST Endpoints:** `GET /api/candidates/{candidate_id}/badges`.

---

### 4.15 Conversational AI Preliminary Screening (L1) & Summary Packs
- **User Story:** As a recruiter, I want to conduct an automated preliminary L1 technical screening and generate a pre-interview summary pack for technical interviewers.
- **Capabilities:**
  - Customized Q&A question generation tailored to role requirements and candidate background.
  - Candidate answer submission with automated rubric scoring (0-100) and AI feedback.
  - Pre-interview summary pack compilation summarizing candidate communication and technical readiness.
- **REST Endpoints:** `POST /api/screening/session`, `POST /api/screening/answer`, `GET /api/screening/candidate/{candidate_id}`.

---

### 4.16 Job Description Calibration & Optimization Analytics
- **User Story:** As a hiring manager, I want requirement calibration metrics to know if my JD criteria are too strict, low-signal, or under-filtered.
- **Capabilities:**
  - Requirement coverage analysis across candidate pool classifying skills into `too_strict`, `low_signal`, `under_filtered`, or `balanced`.
  - Recruiter-facing calibration advice paragraph.
- **REST Endpoints:** `GET /api/jobs/{job_id}/optimization`.

---

## 5. Non-Functional Requirements & Compliance

1. **Security & Audit Control**:
   - All actions (agent queries, job updates, candidate decisions, interview scheduling) write to an immutable `audit_logs` repository (`store.audit_logs`).
   - Recruiter identity tracking via `X-Recruiter-Email` header.
2. **PII Privacy & Bias Mitigation**:
   - Blind review mode masks candidate PII in memory before rendering frontend structures or calling LLM analysis.
3. **Storage & Data Integrity**:
   - Built on `JsonBlobStore` & `Store` facade. Supports disk-persisted JSON blobs (`USE_MOCK_AZURE=true`) or real Azure Blob Storage without schema migrations.
4. **Performance & Reliability**:
   - Async non-blocking API handlers with fast fallback regex engines ensuring graceful degradation when external services are unavailable.

---

## 6. Verification & Quality Acceptance Matrix

| Verification Domain | Command / Method | Result | Status |
|---|---|---|---|
| **Backend Unit & Integration Tests** | `python -m pytest -v` (in `backend/`) | 36 / 36 tests passed in 3.65s | ✅ PASS |
| **Frontend Production Build** | `npm run build` (in `frontend/`) | 0 errors; client & SSR bundles compiled cleanly | ✅ PASS |
| **API OpenAPI Compliance** | `GET http://localhost:8000/docs` | All 25 REST endpoints registered & validated | ✅ PASS |
