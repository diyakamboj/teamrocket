# ResumeIQ — Target Architecture

> **Status:** `phase-2` — Monorepo fully integrated (`frontend/` TanStack Start + `backend/` FastAPI + `copilot/` RAG). Domain entities persisted via `JsonBlobStore` repository pattern.
> **Audience:** Product Managers, System Architects, Software Engineers.

This document describes the **`phase-2`** target architecture for ResumeIQ: service boundaries, storage facade design, the AI pipeline, Azure infrastructure, and system integration.


---

## 1. Design goals

1. **Production-quality, cloud-deployable** ΓÇö Azure-native, Terraform-defined, CI/CD-delivered. Nothing in this document requires a laptop.
2. **Clean separation of concerns** ΓÇö frontend, backend/API, AI services, background workers, and infrastructure are distinct boundaries with explicit contracts, so the internship team can parallelize and the architecture can outgrow any one person.
3. **Deterministic-first, AI-augmented** ΓÇö every score is computable without an LLM. AI refines and *explains*; it never replaces the auditable core. This keeps cost bounded and decisions defensible.
4. **Evidence-backed by construction** ΓÇö every claim a recruiter sees traces to a quoted source in a resume. No score, verdict, or copilot answer is fabricated.
5. **Graceful degradation** ΓÇö the product works with zero Azure credentials (heuristic parsers, keyword matching) and clearly labels which engine produced each result. Cloud is an upgrade, not a dependency.
6. **PII-safe** ΓÇö resume data is personal data. Auth, encryption at rest, least-privilege, and auditability are core requirements, not features.

---

## 2. System context

```
                         ΓöîΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÉ
                         Γöé                 Recruiter                     Γöé
                         Γöé        (authenticated browser session)       Γöé
                         ΓööΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓö¼ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÿ
                                         Γöé HTTPS
                                         Γû╝
                          ΓöîΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÉ
                          Γöé        Web app (BFF)       Γöé  TanStack Start SSR
                          Γöé  UI ┬╖ auth sessions ┬╖ proxyΓöé  React + Server Fns
                          ΓööΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓö¼ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÿ
                                          Γöé HTTPS (REST)
                                          Γû╝
                          ΓöîΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÉ
                          Γöé       API service          Γöé  Workflows: ingestion,
                          Γöé  validation ┬╖ orchestrationΓöé  screening, jobs, queries
                          ΓööΓöÇΓöÇΓöÇΓö¼ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓö¼ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÿ
                              Γöé              Γöé
              ΓöîΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓû╝ΓöÇΓöÇΓöÇΓöÇΓöÉ   ΓöîΓöÇΓöÇΓöÇΓöÇΓöÇΓû╝ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÉ
              Γöé  Background worker Γöé   Γöé     AI engine          Γöé  provider-agnostic
              Γöé  (queue consumer)  Γöé   Γöé parse ┬╖ JD ┬╖ match ┬╖   Γöé  Azure OpenAI + OSS
              Γöé                    Γöé   Γöé embed ┬╖ agent          Γöé  fallbacks
              ΓööΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓö¼ΓöÇΓöÇΓöÇΓöÇΓöÿ   ΓööΓöÇΓöÇΓöÇΓöÇΓöÇΓö¼ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÿ
                              Γöé              Γöé
                              Γû╝              Γû╝
   ΓöîΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÉ
   Γöé                       Azure data plane                      Γöé
   Γöé  Cosmos DB (records) ┬╖ Blob Storage (files) ┬╖ Key Vault     Γöé
   Γöé  (later) Cognitive Search (vector) ┬╖ App Insights (telemetry)Γöé
   ΓööΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÿ
                              Γû▓
                              Γöé control plane
   ΓöîΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÉ
   Γöé  Terraform (Azure resources) ┬╖ GitHub Actions (CI/CD)       Γöé
   ΓööΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÿ
```

**Request flow (screening example):**

1. Recruiter uploads resumes ΓåÆ web app streams files to **Blob Storage** and enqueues an **ingest job**.
2. **Worker** drains the queue: extract text (Azure Document Intelligence OCR, or local text-layer), parse (Azure OpenAI or heuristic), write structured `ParsedResume` to **Cosmos DB**, update per-file status.
3. Recruiter pastes a job description ΓåÆ API calls **AI engine** ΓåÆ structured `Requirement[]` returned, stored as a `JobRecord`.
4. Recruiter starts screening ΓåÆ API snapshots completed resumes, enqueues a **screening run**.
5. **Worker** runs the three-signal matcher (keyword ΓåÆ semantic embeddings ΓåÆ LLM best-first), persists `MatchRecord`s, publishes progress.
6. Web app polls run progress and renders ranked candidates; recruiter weights re-rank client-side instantly; every score/verdict surfaces its evidence.

---

## 3. Service boundaries

### 3.1 Service map

| # | Service | Responsibility | Owns | Reference implementation today |
|---|---|---|---|---|
| 1 | **Web app (BFF)** | SSR UI, auth session, route-level data needs, proxying to API, client-side re-ranking & filters | `src/routes/*`, `src/components/*`, client state | `parsing-feature` (mock) |
| 2 | **API service** | Workflow orchestration, validation, authorization, job/resume lifecycle, screening run control | ingest/screening entrypoints, `JobRecord`/`ResumeRecord`/`MatchRecord` lifecycle | `src/lib/api/*` + `server/screening.ts` |
| 3 | **AI engine** | Model-agnostic intelligence: parse, JD analysis, candidate analysis, embeddings, (later) copilot agent | prompts, schemas, provider clients, token budgeting | `server/ai/*`, `resume-parser.ts`, `jd-analyzer.ts`, `matching.ts` |
| 4 | **Background worker** | Durable execution of ingestion + screening jobs from a queue | queue consumer, pipeline stage machine, progress events | `server/pipeline.ts` (in-process today) |
| 5 | **Data plane** | Durable storage: records, blobs, secrets, (later) vectors | Cosmos DB, Blob Storage, Key Vault | `server/store.ts` (JSON-file) |
| 6 | **Infrastructure** | Everything above is deployed by | Terraform modules, GitHub Actions | none |

### 3.2 Boundary rules (non-negotiable)

- **Web Γåö API:** web talks to API only over authenticated REST. Server functions must not reach Azure directly (today's `createServerFn` handlers call server modules directly ΓÇö that's fine for the modular-monolith phase, but the *contract* is the API shape in `src/lib/api/*`, not the module internals).
- **API Γåö AI engine:** API passes domain objects (`ParsedResume`, `JobRecord`, `Requirement[]`) to the AI engine and gets structured, validated results back. The API never sees prompts, schemas, model names, or API keys. **This seam is what makes model-provider swaps (Azure Γåö OSS) safe.**
- **Worker Γåö AI engine:** the worker is the only caller of the expensive per-candidate analysis. Screening is never run on the API request thread.
- **AI engine has no storage dependency:** it is a pure function of (input text/objects + model config). State lives in API/worker/data plane. This keeps it trivially testable and cacheable.
- **Secrets:** only the AI engine and the web/worker bootstrap touch secrets, and only via **Key Vault with managed identity** ΓÇö never environment files in production, never the client bundle.

### 3.3 Phasing note (important for an internship team)

We do **not** deploy six separate services on day one. The target boundaries above map 1:1 onto module boundaries in a **modular monolith** first:

```
web + api + worker   (one Node app, `src/lib/server/*`)
        Γöé
        ΓööΓöÇΓöÇ ai engine (module, `src/lib/server/ai/` + parsers)
```

The `Aasrith` reference is already this shape. The **extraction into separate services happens only when** (a) screening latency/cost demands independent scaling, or (b) a second consumer of the API appears. The architecture is designed so that split is mechanical (the seams already exist); it is not a reason to build it now. **One exception: the durable worker/queue must be introduced early** because the current in-process background screening cannot survive serverless (see ┬º7).

---

## 4. Component responsibilities (mapped to current code)

| Component | Responsibility | Reference file (`origin/Aasrith`) |
|---|---|---|
| **Ingest** | File intake, size limits, SHA-256 dedupe, queuing | `server/pipeline.ts` |
| **Extract** | Text-layer detection, local PDF text, Azure DI OCR routing | `server/pdf-text.ts`, `server/document-intelligence.ts` |
| **Parse** | Structured `ParsedResume` from text (AI + heuristic fallback) | `server/resume-parser.ts` |
| **JD analyze** | `Requirement[]` from description (AI + heuristic fallback) | `server/jd-analyzer.ts` |
| **Match** | Three-signal scoring, verdicts, strengths/gaps, must-have accounting | `server/matching.ts` |
| **Screen** | Run orchestration, progress reporting, result persistence | `server/screening.ts` |
| **Store** | Durable records (JSON-file today; Cosmos DB target) | `server/store.ts` |
| **RPC** | `createServerFn` endpoints (webΓåöserver contract) | `lib/api/jobs.ts`, `lib/api/resumes.ts` |
| **Shared types** | Cross-boundary contracts + scoring helpers | `lib/types.ts` |

---

## 5. Data model & storage

### 5.1 Core entities (already modeled in `src/lib/types.ts`)

```
ResumeRecord        id, fileName, fileSize, stage, progress, error,
                    duplicateOf, uploadedAt, processedAt, pageCount,
                    scanned, textSource, parseEngine, parsed? (ParsedResume)
JobRecord           id, title, description, summary, requirements[], reviewed,
                    createdAt, updatedAt, analyzedBy
Requirement         id, category, text, must, keywords[], minYears?
MatchRecord         resumeId, jobId, categories{}, signals{}, requirements[] (verdicts),
                    strengths[], gaps[], transferable[], evidence[], summary,
                    aiAnalyzed, mustHavesMet/Total, scoredAt
ScreeningRun        jobId, startedAt, finishedAt?, total, scored, aiAnalyzed,
                    running, error?
ParsedResume        name/email/phone/location/title/summary/totalYearsExperience,
                    links[], skills[] (name+evidence+years), experience[],
                    education[], certifications[], projects[]
```

### 5.2 Storage strategy (target)

| Data | Target store | Why |
|---|---|---|
| Raw resume files | **Azure Blob Storage** | Large, immutable, cheap; private container; SAS/entra-scoped access |
| `ResumeRecord` / `JobRecord` / `MatchRecord` / `ScreeningRun` | **Azure Cosmos DB (NoSQL)** | Document-shaped, partition by `jobId`/account, flexible schema as features evolve |
| Embedding vectors | Cosmos DB (small, hot) ΓåÆ **Azure AI Search** (later, for candidate similarity search) | Vector index + hybrid keyword/vector retrieval |
| Secrets | **Azure Key Vault** | Managed identity access, rotation |
| Pipeline state / progress | queue message + Cosmos `stage` field | resumes with the worker |

**Migration path from today:** `.data/store.json` (reference) ΓåÆ Cosmos DB with a one-time script. Keep the store behind the `store.ts` interface so the swap is contained. **Do not ship the JSON-file store to production** ΓÇö it is single-process, non-durable across restarts under concurrency, and unencrypted.

### 5.3 Partitioning / indexing notes

- Partition Cosmos DB containers by `accountId` (future multi-tenant) or `jobId` (single-tenant MVP).
- `resumes` container: partition by account, index by `stage`, `uploadedAt`.
- `matches` container: partition by `jobId`, keyed by `resumeId` (the reference already models `jobId ΓåÆ resumeId ΓåÆ MatchRecord`).
- Requirement keywords and evidence are stored denormalized on `MatchRecord` so the ranking UI never joins.

---

## 6. API surface (contract)

The RPC layer on `Aasrith` already defines the right verbs ΓÇö promote them to a versioned REST surface when the API splits out:

```
GET    /capabilities            ΓåÆ AzureCapabilities (what the UI can offer)
GET    /jobs/active             ΓåÆ JobSnapshot        (job + run + pool size + caps)
POST   /jobs/analyze            ΓåÆ analyze JD ΓåÆ JobRecord
PUT    /jobs/{id}/requirements  ΓåÆ save reviewed requirements (invalidates matches)
POST   /jobs/{id}/screening     ΓåÆ start screening run (async)
GET    /jobs/{id}/screening     ΓåÆ run progress
GET    /jobs/{id}/candidates    ΓåÆ ranked Candidate[]
GET    /resumes                 ΓåÆ ResumeRecord[] + counts + caps
POST   /resumes/upload          ΓåÆ multipart, batch Γëñ15 files
POST   /resumes/{id}/retry
POST   /resumes/retry-failed
POST   /resumes/cancel-queued
POST   /resumes/{id}/duplicate  ΓåÆ { skip | replace }
DELETE /resumes                 ΓåÆ clear all
```

Rules: idempotent where possible, all mutating calls authenticated + CSRF-protected, uploads size-limited at the edge, screening endpoints return immediately (202) with a run id to poll.

---

## 7. AI pipeline (the core of the product)

### 7.1 Pipeline overview

```
Resume files ΓöÇΓöÇΓû║ [1 Ingest] ΓöÇΓöÇΓû║ [2 Extract] ΓöÇΓöÇΓû║ [3 Parse] ΓöÇΓöÇΓû║ ParsedResume
                                              (text)          (structured)

Job description ΓöÇΓöÇΓû║ [4 JD analyze] ΓöÇΓöÇΓû║ Requirement[]

ParsedResume[] + Requirement[] ΓöÇΓöÇΓû║ [5 Match] ΓöÇΓöÇΓû║ MatchRecord[]
                                          Γöé
                                   keyword ΓåÆ semantic ΓåÆ AI
                                          Γöé
                               [6 Rank & explain] ΓöÇΓöÇΓû║ Candidate[] (UI)

Recruiter question ΓöÇΓöÇΓû║ [7 Copilot agent] ΓöÇΓöÇΓû║ evidence-backed answer
```

### 7.2 Stage-by-stage

**1. Ingest** (`server/pipeline.ts`)
- Batch uploads (Γëñ15 files/request), SHA-256 content hash ΓåÆ duplicate detection by content, not filename.
- Size caps (`RESUME_MAX_FILE_BYTES`), typed stage machine `queued ΓåÆ uploading ΓåÆ extracting ΓåÆ ocr ΓåÆ parsing ΓåÆ complete|failed|duplicate|skipped`.
- Concurrency-limited worker pool (`RESUME_PIPELINE_CONCURRENCY`). **Target:** these stages move into the durable queue worker.

**2. Extract** (`pdf-text.ts`, `document-intelligence.ts`)
- Local pass first: cheap embedded-text extractor decides "scanned?" without paying for OCR.
- `prebuilt-read` via Azure Document Intelligence for born-digital text and transparent OCR of scans; async submit ΓåÆ poll with backoff; legacy `/formrecognizer` fallback for old resources.
- Failure taxonomy preserved to the UI: *password-protected, empty scan, unsupported format, Azure rejected file* ΓÇö each retryable with the actual reason shown.

**3. Parse** (`resume-parser.ts`)
- Azure OpenAI chat, JSON-schema-constrained ΓåÆ `ParsedResume`. System prompt enforces **never invent, never infer**; evidence quoted per skill.
- Coercion layer (`coerce`) sanitizes model output; `backfill` fills contact details from regex when the model skipped them.
- **Heuristic fallback** (regex/keyword parser) when chat is unavailable ΓÇö labeled `"heuristic"` in the UI.

**4. JD analyze** (`jd-analyzer.ts`)
- Azure OpenAI ΓåÆ discrete `Requirement[]` with category, MUST/NICE, keyword aliases, `minYears`. Prompt rule: *must = true only when the JD states it as required/essential*.
- Every requirement is editable; editing invalidates the prior ranking (matches cleared). Heuristic fallback via line/bullet extraction.

**5. Match** (`matching.ts`) ΓÇö **three-signal scoring, the heart of the product**

| Signal | What | Deterministic? | Cost |
|---|---|---|---|
| **Keyword** | Requirement keywords matched against the *relevant resume section* (out-of-section hits count half); tenure check for "N+ years" | Γ£à yes | ~0 |
| **Semantic** | Cosine similarity between requirement and per-category resume embeddings (Azure embeddings, disk-cached) | Γ£à yes (embeddings) | low, cached |
| **AI** | Per-candidate LLM: per-requirement `met/partial/missing` verdicts with quoted evidence, category scores, strengths/gaps/transferable, summary | Γ¥î | high ΓÇö **best-first over top `SCREENING_AI_ANALYSIS_LIMIT` (default 50)** |

- Category score = blend of the three signals (`0.6/0.4` keyword/semantic when AI absent; `0.3/0.2/0.5` with AI).
- Must-have accounting: `mustHavesMet` / `mustHavesTotal` per candidate.
- **Target additions:** adaptive AI-analysis budget (scale with pool size), token accounting per run, and a hard daily spend guard.

**6. Rank & explain** (client, `src/lib/types.ts`)
- Raw category scores stored server-side; recruiter `Weights` applied client-side ΓåÆ **instant re-ranking** without recomputation.
- Ranking UI shows overall score, category breakdown, must-haves met, and expandable per-requirement coverage with quoted evidence.
- Blind-review mode hides names/contact in the UI.

**7. Copilot agent** (Level 1 ΓÇö currently a rule-based placeholder)
- **Target:** a tool-using agent over screening data. Structured tools like `search_candidates(skill)`, `get_verdicts(candidateId)`, `compare(ids[])`, `gap_summary()`.
- Grounded answers only: every claim cites a stored verdict/evidence. System prompt enforces the same *never fabricate* discipline as the rest of the pipeline.
- PII rule: in blind mode the agent must answer from anonymized projections or be documented as UI-only.

### 7.3 AI engine design (target)

```
          ΓöîΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÉ
          Γöé  AI engine (provider-agnostic)           Γöé
          Γöé  ChatClient   EmbeddingClient interfaces Γöé
          Γöé        Γû▓                 Γû▓                Γöé
          Γöé   ΓöîΓöÇΓöÇΓöÇΓöÇΓö┤ΓöÇΓöÇΓöÇΓöÉ         ΓöîΓöÇΓöÇΓö┤ΓöÇΓöÇΓöÇΓöÇΓöÉ           Γöé
          Γöé  AzureOpenAI        OpenAICompat/OSS    Γöé
          Γöé  (primary)          (Ollama/vLLM/ΓÇª)     Γöé
          ΓööΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÿ
```

- Both implementations share the OpenAI-compatible REST contract; Azure adds `api-key` headers + deployment URLs. The reference's `openai.ts` is now the `server/ai/` seam (Step B) ΓÇö the app never imports Azure directly.
- Structured outputs preferred (`response_format: json_schema`), degraded to `json_object`, with a tolerant JSON-salvage extractor.
- **OSS fallback path** (for dev/training/internship demos with no Azure budget): self-hosted OpenAI-compatible chat + embeddings (Ollama/vLLM/LM Studio) and Tesseract-class OCR replacing Document Intelligence. Quality drops; deterministic signals keep the product usable.

---

## 8. Infrastructure & deployment

### 8.1 Azure topology (target, single region first)

```
Azure Resource Group "rg-resumeiq"
Γö£ΓöÇΓöÇ App: Web app (TanStack Start)         ΓÇö Container App / App Service (Node)
Γö£ΓöÇΓöÇ App: API service                      ΓÇö Container App / App Service (Node)
Γö£ΓöÇΓöÇ App: Worker (queue consumer)          ΓÇö Container App (scale-to-zero off)
Γö£ΓöÇΓöÇ Data: Cosmos DB (NoSQL)               ΓÇö records (resumes/jobs/matches/runs)
Γö£ΓöÇΓöÇ Data: Storage account                 ΓÇö blob container `resumes` (private)
Γö£ΓöÇΓöÇ Data: Key Vault                       ΓÇö OpenAI/DI keys, DB connection strings
Γö£ΓöÇΓöÇ AI:  Azure OpenAI (deployments: chat, embeddings)
Γö£ΓöÇΓöÇ AI:  Azure AI Document Intelligence
Γö£ΓöÇΓöÇ Obs: Log Analytics + Application Insights
ΓööΓöÇΓöÇ (Later) Azure AI Search + Azure Front Door/WAF
```

### 8.2 Terraform layout (target)

```
infra/
Γö£ΓöÇΓöÇ environments/
Γöé   Γö£ΓöÇΓöÇ dev/            backend.tf, terraform.tfvars
Γöé   Γö£ΓöÇΓöÇ staging/        ...
Γöé   ΓööΓöÇΓöÇ prod/           ...
Γö£ΓöÇΓöÇ modules/
Γöé   Γö£ΓöÇΓöÇ web/            container app, DNS, WAF rule
Γöé   Γö£ΓöÇΓöÇ api/            container app, API gateway/config
Γöé   Γö£ΓöÇΓöÇ worker/         container app + queue wiring
Γöé   Γö£ΓöÇΓöÇ data/           cosmos db, storage, key vault
Γöé   Γö£ΓöÇΓöÇ ai/             openai + document intelligence (with purge-protection)
Γöé   ΓööΓöÇΓöÇ observability/  log analytics, app insights
ΓööΓöÇΓöÇ main.tf             backend = Azure Storage (state locking)
```

- **Remote state** in a versioned storage container with locking.
- **Secrets never in state:** Key Vault references only; identities via `azurerm_user_assigned_identity` + role assignments.
- Resource naming + tagging convention documented in `deployment.md`.

### 8.3 CI/CD (GitHub Actions ΓÇö target)

```
on: push / pull_request
Γö£ΓöÇΓöÇ CI: bun install ΓåÆ lint ΓåÆ typecheck ΓåÆ test (Vitest) ΓåÆ build
Γö£ΓöÇΓöÇ CD (on merge to main):
Γöé   Γö£ΓöÇΓöÇ terraform plan/apply (env: dev)
Γöé   Γö£ΓöÇΓöÇ docker build & push (ACR) for web/api/worker
Γöé   Γö£ΓöÇΓöÇ deploy (Container Apps)  ΓåÆ smoke test
Γöé   ΓööΓöÇΓöÇ promote staging ΓåÆ prod (manual approval gate)
ΓööΓöÇΓöÇ scheduled: cost/health checks, model-deployment revalidation
```

Pipeline quality gates: no `any`, lint clean, tests green, `bun run build` passes, docs updated if contracts changed.

### 8.4 Configuration & secrets

| Type | Mechanism |
|---|---|
| Non-secret tuning | env vars (reference `config.ts` already centralizes: concurrency, file limits, AI-analysis limit, data dir) |
| Secrets | Azure Key Vault; injected via managed identity at boot |
| Client-visible | only `VITE_*` non-secrets; the reference's server-side `.env` loader keeps secrets off the bundle ΓÇö preserve this invariant |
| Engines | `AzureCapabilities` computed server-side and exposed so the UI adapts |

### 8.5 Observability (target)

- **Structured logs** with a correlation id per request/run: ingest, each pipeline stage, each Azure call (tokens, latency, status), screening progress.
- **Metrics:** upload throughput, parse success rate, DI/OpenAI latency, screening run duration, token cost per run, queue depth.
- **Distributed tracing** across web ΓåÆ API ΓåÆ worker ΓåÆ AI.
- **Alerts:** run failure rate, queue backlog, Azure 429 throttling, per-run token budget breach, any production exception.

### 8.6 Cost posture

- Document Intelligence S0 tier; Azure OpenAI deployments scaled by quota, **not** unlimited.
- Deterministic-first design means the LLM runs only on the top-N shortlist ΓÇö cap with `SCREENING_AI_ANALYSIS_LIMIT` and monitor per-run tokens.
- Worker scale-to-zero when idle in dev; prod worker scales on queue depth.

---

## 9. Security, privacy & compliance

1. **AuthN/AuthZ:** recruiters authenticate (Azure Entra ID recommended); API enforces authorization per action; uploads restricted to authed users. **None of this exists today** ΓÇö it is the first hardening gate before any real data.
2. **PII handling:** resumes are personal data. Private blob container, encryption at rest (Azure default), no PII in logs/metrics, retention/deletion policy (the UI already has "clear all" ΓÇö make it auditable).
3. **Blind-review integrity:** if blind mode is a hard guarantee, PII is stripped before AI analysis; otherwise it is UI-only and that limitation is documented to recruiters.
4. **LLM output handling:** schemas + coercion everywhere (already a pattern in the reference); never render raw model output as HTML (escape at the boundary).
5. **Supply chain:** Bun's 24h release-age guard already enabled (`bunfig.toml`); add `npm audit`-equivalent in CI; pin base images.
6. **Data egress:** OpenAI/DI calls carry resume content ΓÇö document that this is a GDPR Art. 28 processor relationship and keep Azure region aligned with the data residency requirement.

---

## 10. Scaling & failure modes

| Concern | Design answer |
|---|---|
| 500+ resume batch | Batch upload (Γëñ15), async ingestion, concurrency pool, typed progress; scale worker on queue depth |
| Screening cost blowout | Deterministic-first, top-N AI budget, per-run + daily token guards |
| Azure 429 / throttling | `requestWithRetry` with `Retry-After` (reference already implements) + circuit-breaking at the worker |
| Worker crash mid-run | Durable queue + idempotent stages; `ScreeningRun` status in DB; retry on recovery |
| Model returns garbage | Coercion + validation; heuristic fallback when AI output is unusable (reference pattern) |
| Single-instance JSON store | Replaced by Cosmos DB + Blob before production (non-negotiable) |
| Serverless request-lifecycle kill | Screening/ingestion moved off the request thread into the worker (non-negotiable) |

---

## 11. Roadmap

### Phase 0 ΓÇö Reconcile & stabilize (foundation)
- Merge `origin/Aasrith` implementation onto the working branch; delete `mock-data.ts`; align `main`.
- Write `development.md`, `ai-architecture.md`, `deployment.md`; rewrite `README.md`.
- Add `.gitignore`, `.env.example` on the merged branch; remove the orphaned `venv/`.

### Phase 1 ΓÇö MVP hardening (ship a real, safe MVP)
1. **Auth + tenancy** (Entra ID; API authorization; PII rules). *Gate for any real deployment.*
2. **Durable worker + queue** (Azure Queue Storage; move `pipeline.ts` stages + screening off the request thread).
3. **Real datastore** (Cosmos DB + Blob Storage behind `store.ts` interface; one-time migration from `.data/`).
4. **Test suite** (Vitest): `keywordSignal`/`yearsSignal`/`blend`, coercion/extractJson safety, heuristic parsers, offline smoke test.
5. **Structured logging + request correlation.**

### Phase 2 ΓÇö Level 1 features
- Evidence-tracing UI (per-requirement coverage, quoted sources, signal breakdown).
- Copilot agent (tool-using, grounded; replace rule-based `answer()`).
- Adjustable scoring (weights) ΓÇö already designed; surface per-signal impact.
- Blind-review hardening (PII stripping or documented UI-only semantics).
- Dashboard features (real stats from stored records, not mock).

### Phase 3 ΓÇö Infrastructure & delivery
- Terraform modules + environments (dev/staging/prod), remote state, Key Vault wiring.
- GitHub Actions CI/CD (lint ΓåÆ typecheck ΓåÆ test ΓåÆ build ΓåÆ terraform ΓåÆ deploy ΓåÆ smoke).
- Observability (App Insights, metrics, alerts), cost dashboards.

### Phase 4 ΓÇö Scale & quality
- AI engine provider abstraction (Azure Γåö OpenAI/OSS), embeddings cache promotion.
- Azure AI Search for candidate similarity / duplicate detection at scale.
- Multi-tenancy, retention policies, audit logs.
- Performance: screening run parallelism, cold-start tuning, cache strategy.

### Roadmap principles
- Each phase is independently shippable; no phase blocks demo-ability (offline mode keeps the app runnable through Phase 2).
- Cost/scope checked with the TPM before Phase 3 (infra spend).
- The deterministic/AI split means AI quality can be tuned without touching storage or UI contracts.

---

## 12. Open decisions (for the TPM / team)

1. **Backend language path:** keep the TS implementation (fast, matches `Aasrith`) vs. port to Python (the orphaned `venv/` hints this was considered). Recommendation: **stay TS** for MVP; a Python service can be added behind the API contract later without a rewrite.
2. **Deployment target:** Azure Container Apps (recommended ΓÇö managed, worker-friendly) vs. App Service vs. Cloudflare Workers (`nodejs_compat`; cheaper but worker/queue story is weaker).
3. **Screening trigger:** auto-run on upload+JD vs. explicit "Start screening" (reference uses explicit ΓÇö keep it; it makes cost visible).
4. **AI-analysis budget:** fixed top-50 default is a starting point; decide whether it becomes adaptive before Phase 2.
5. **Multi-tenancy:** single-tenant MVP (recommended) with the data model already partition-friendly.

---

*This document is a target design. Where it disagrees with the current code, the code is the source of truth for today and this document is the plan. Update this document when contracts or boundaries change ΓÇö the schema for `ParsedResume`/`MatchRecord` in `src/lib/types.ts` is the contract all services share.*
