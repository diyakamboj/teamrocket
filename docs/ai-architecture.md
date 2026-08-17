# ResumeIQ ΓÇö AI Architecture

How intelligence is structured: the provider seams, prompts and schemas, the three-signal scoring model, cost controls, fallback behavior, and the copilot agent. Companion docs: [architecture.md](architecture.md) (overall design), [development.md](development.md) (local dev), [deployment.md](deployment.md) (deploy/ops).

> **Branch:** `phase-1` — AI logic is implemented in **`backend/app/services/`** (Python FastAPI). The original TypeScript reference lived on `parsing-feature` (`src/lib/server/`).

---

## 1. Guiding principles

1. **LLM output is untrusted data.** Every model response is coerced and validated against a schema before it touches the domain. Never let raw output reach the UI or database.
2. **Deterministic first, AI-augmented.** Every score is computable without an LLM. AI refines and explains; it never replaces the auditable core.
3. **Evidence over assertion.** Every verdict cites a quoted source. Models are explicitly instructed to never claim evidence that is not in the resume.
4. **Cost-bounded by design.** Expensive per-candidate LLM calls run best-first over a configurable limit ΓÇö never the whole pool.
5. **Graceful degradation is a product feature.** With no Azure credentials the app still works and labels which engine produced each result.

---

## 2. AI seams (where intelligence plugs in)

There are exactly three provider touch-points, all behind a `capabilities()` gate computed from config:

| Seam | Files | Function |
|---|---|---|
| **Document Intelligence** | `server/document-intelligence.ts` | OCR / text extraction for scanned resumes (`prebuilt-read`, async submit ΓåÆ poll) |
| **Chat** | `server/ai/` ΓÇö `chatJson()` | Structured-output chat for parsing, JD analysis, candidate analysis |
| **Embeddings** | `server/ai/` ΓÇö `embed()` | Semantic similarity for the matching signal, disk-cached |

`AzureCapabilities` (`{ documentIntelligence, chat, embeddings }`) is exposed to the UI so the frontend adapts (e.g. "offline parser" labels, disabling semantic features).

### Target: provider abstraction

Wrap chat/embeddings behind interfaces so the app never imports Azure directly:

```
ChatClient.            EmbeddingClient.
Γö£ΓöÇΓöÇ AzureOpenAI        Γö£ΓöÇΓöÇ AzureOpenAI          (primary; api-key headers, deployment URLs)
ΓööΓöÇΓöÇ OpenAICompat       ΓööΓöÇΓöÇ OpenAICompat/OSS     (Ollama, vLLM, LM Studio ΓÇö same REST contract)
```

Both implementations share the OpenAI-compatible REST shape. The reference's single `openai.ts` was split into the `server/ai/` seam (Step B): `types.ts` defines `ChatClient`/`EmbeddingClient`, `azure.ts` owns the REST transport + retry + JSON salvage, `chat.ts`/`embeddings.ts` are the Azure implementations, and `index.ts` holds lazy singletons. Swapping to an OSS provider now means adding a client factory in `index.ts` ΓÇö nothing else changes. **OSS path (for dev/demos with no Azure budget):** self-hosted chat + embeddings and a Tesseract-class OCR replacing Document Intelligence.

## 3. Prompts & schemas

All three AI calls use **JSON-schema-constrained structured output**, degrade to `json_object` mode when the deployment rejects it, and salvage JSON from prose via a tolerant `extractJson()`. Models run at `temperature: 0`.

### 3.1 Resume parsing (`server/resume-parser.ts`)

**System prompt contract:** a resume-parsing engine for a recruiting platform. Rules the model must obey:
- Extract **exactly as written** ΓÇö never invent, infer, or embellish.
- `""` or omit fields the resume does not state. Do not guess.
- `totalYearsExperience` = summed duration of professional roles (exclude internships < 6 months and education), one decimal.
- Skills must be concrete (technologies/tools/languages/methodologies) ΓÇö **no soft-skill filler** like "team player".
- Every skill carries `evidence` quoting where in the resume it's demonstrated.
- Return JSON only.

**Output schema (abridged):**
```
{ name?, email?, phone?, location?, title?, summary?,
  totalYearsExperience?: number, links: string[],
  skills: [{ name, evidence?, years? }],
  experience: [{ company, title, startDate?, endDate?, current?, location?, highlights[], technologies[] }],
  education: [{ institution, degree, field?, graduationYear?, grade? }],
  certifications: [{ name, issuer?, issueDate?, expiryDate? }],
  projects: [{ name, description?, technologies[], url? }] }
```

**Safety layers:** `coerce()` sanitizes shape (wrong types ΓåÆ dropped, not crashed); `backfill()` fills contact details + tenure from regex when the model skipped them; if the model returns nothing usable, the **heuristic regex parser** is used and the engine is labelled `"heuristic"`.

### 3.2 JD analysis (`server/jd-analyzer.ts`)

**System prompt contract:** extract screening requirements. Rules:
- One requirement per distinct, checkable criterion.
- `category` Γêê `{Skills, Experience, Education, Certifications}` exactly.
- `text` Γëñ 12 words, recruiter-readable (e.g. "5+ years backend engineering").
- `must = true` **only** when the JD states required/essential/minimum; `preferred/nice-to-have/bonus` ΓåÆ `false`.
- `keywords` = literal search terms incl. aliases ("Kubernetes" ΓåÆ kubernetes, k8s, eks, aks), 3ΓÇô8 per requirement, lowercase.
- `minYears` only on Experience requirements that state a duration.
- Don't invent requirements; don't duplicate a criterion across categories.

**Output schema (abridged):**
```
{ title, summary, requirements: [{ category, text, must, keywords[], minYears? }] }
```

**Recruiter-editable by design:** every requirement can be rewritten, flipped MUST/NICE, deleted, or added. Editing invalidates the previous ranking (`store.clearMatches(jobId)`). The heuristic fallback (`heuristicRequirements`) is bullet/line based with MUST/NICE marker regexes.

### 3.3 Candidate analysis (`server/matching.ts`) ΓÇö the scoring pass

**System prompt contract:** a technical recruiter assessing one candidate against one role; judge only on what the resume states.
- Per requirement id: `status Γêê {met, partial, missing}` + 0ΓÇô100 score + one-line quoted evidence. **Never claim evidence that is not there.**
- `categoryScores`: 0ΓÇô100 for skills/experience/education/certifications/projects reflecting fit **for this role**, not general quality.
- `strengths`/`gaps`/`transferable`: up to 3 each, evidence-backed.
- `evidence`: up to 5 `{skill, detail, source}` items where `source` names the role/project/cert it came from.
- `summary`: one sentence a recruiter could paste into a shortlist.

The resume is sent as a **compacted JSON projection** (truncated skills/experience/education) ΓÇö not raw text ΓÇö to keep tokens bounded.

---

## 4. The three-signal scoring model

Every category score blends three signals. This is the heart of the product.

| Signal | What it measures | Deterministic | Cost |
|---|---|---|---|
| **Keyword** | Requirement keywords matched against the **relevant resume section** (out-of-section hits count at `0.5`); tenure check for "N+ years" (`yearsSignal`) | Γ£à | ~0 |
| **Semantic** | Cosine similarity between requirement text and per-category resume-section embeddings (Azure embeddings, **disk-cached**) | Γ£à (embeddings) | low, cached |
| **AI** | Per-candidate LLM verdicts + category scores | Γ¥î | high ΓÇö best-first, capped |

### 4.1 Keyword signal
- `matchesKeyword` guards word edges so "go" doesn't match "google" but allows `+ # .` inside tokens.
- Score = blend of best-single-hit (`40┬╖best`) and coverage (`60┬╖weighted/n`), capped at 100 ΓÇö one strong hit already counts a lot; not every alias must match.
- A requirement found in a *different* section (e.g. "AWS" in a job bullet Γëá an AWS *certification* requirement) is weaker evidence.

### 4.2 Semantic signal
- Requirement and resume-section texts are embedded (batched Γëñ 16, truncated to 8k chars), cached by SHA-1 hash in `embeddings.json`.
- Raw cosine is **normalized onto a 0ΓÇô100 scale**: unrelated technical prose Γëê `0.15`, solid match Γëê `0.55` ΓåÆ `((cosine ΓêÆ 0.15) / 0.4) ├ù 100`. Calibration depends on the embedding model ΓÇö re-check on model change.
- Projects (no requirements of their own) are measured against the whole role.

### 4.3 AI signal & blending
- Blend weights shift when the AI signal is absent:

| Signals available | Weights |
|---|---|
| keyword + semantic (no AI) | `0.6 / 0.4` |
| keyword + semantic + AI | `0.3 / 0.2 / 0.5` |

- Per-requirement verdicts prefer the LLM's `met/partial/missing` when present; otherwise derived from the keyword score (`ΓëÑ70 met, ΓëÑ35 partial, else missing`).
- Must-have accounting: `mustHavesMet` / `mustHavesTotal` computed per candidate.

### 4.4 Ranking & explainability
- **Raw category scores are stored** (`MatchRecord.categories`) ΓÇö recruiter `Weights` are applied **client-side** for instant re-ranking without recomputation (`scoreOf`/`rankCandidates` in `src/lib/types.ts`).
- Every rendered score/verdict surfaces its evidence: per-requirement coverage, signal breakdown, and quoted sources.

---

## 5. Cost model & budget controls

The deterministic/AI split is what keeps cost sane:

1. **Deterministic pass scores the whole pool** (keyword + cached embeddings) ΓÇö near-zero marginal cost.
2. **LLM pass runs best-first** over the top `SCREENING_AI_ANALYSIS_LIMIT` candidates (default 50), with `SCREENING_CONCURRENCY` parallel analyses.
3. **Embeddings are cached on disk** ΓÇö re-screening the same pool is nearly free; a requirement edit only re-embeds the changed text.
4. **Token bounds at every call:** resume text truncated to 40k chars, JD to 30k, `max_tokens` set per call (parse 4000, JD 2500, analysis 2000).

**Planned additions (Phase 2/4):**
- Adaptive AI-analysis budget that scales with pool size.
- Per-run token accounting + a hard daily spend guard (alert + circuit-breaker).
- Model-tier strategy: cheap model for parsing, better model for the shortlist analysis.

## 6. Fallback / offline behavior

| Azure unavailable | Fallback |
|---|---|
| Document Intelligence | Local PDF text-layer extractor; scanned/non-PDF files fail with a message naming the missing env vars |
| Chat (parse/JD) | Heuristic regex parsers, labelled `"heuristic"` / `"offline parser"` in the UI |
| Chat (analysis) | Deterministic-only verdicts/strengths/gaps from keyword scores |
| Embeddings | Keyword signal alone (blend shifts to `0.6/0.4`) |

Every `MatchRecord` records `aiAnalyzed` and its `signals` so the UI can show *why* a result is what it is and whether AI contributed.

## 7. Blind-review semantics

- Blind mode is a **UI toggle** in the ranking/comparison views, and for the **copilot it is a hard guarantee**: the pool the agent and the deterministic fallback operate on is built from an anonymized projection ΓÇö labels become `Candidate #N` (rank-based), and no name, filename, or contact detail reaches the model. Name lookups are disabled against the anonymized pool.
- The screening/analysis pass itself still runs on full resumes (blind mode is recruiters hiding identity, not hiding data from the AI); if that guarantee is ever required, PII must be stripped from the compacted projection before the AI pass (see architecture.md ┬º12).

## 8. Copilot agent

Implemented as a **bounded two-step tool-using agent** (`backend/app/services/copilot_agent.py`, entry `copilot_answer`, API `POST /api/agent/ask`):

```
Recruiter question + jobId + weights + blind flag
   ΓåÆ step 1: model selects ONE tool (structured output, copilotToolCallSchema)
   ΓåÆ tool runs against the STORE-backed pool:
       search_candidates(query | skill | minYears | level)
       get_verdicts(candidateId)
       compare(candidateIds[])
       gap_summary()
       must_have_report()
       schedule_interview(candidateId, durationMinutes, interviewers)
   -> step 2: model writes the answer, citing evidence by id (copilotAnswerSchema)
   -> server resolves ids - **AI Interview Scheduling Seam:** The `schedule_interview` tool and natural-language intent handler parse participant names (e.g. Alex, Priya), duration (30/45/60 mins), and interview types (Technical, Recruiter Screen, System Design) to calculate overlapping interviewer calendar availability (`calendar_service.py`). Returns an interactive `interview_proposal` structured payload allowing recruiters to review proposed slots and confirm booking with Microsoft Teams link auto-generation (`https://teams.microsoft.com/l/meetup-join/...`) and Outlook calendar invites.
- **Public Agent API Endpoint (`POST /api/agent`):** Exposes `query_candidates` to third-party clients and integrations. Accepts flexible JSON request payloads (`"query"` or `"question"`) with optional job/candidate context, returning structured response cards, citations, and tools used.

- **Bounded by design:** at most two chat calls (tool selection ≈400 tokens, answer ≈800 tokens). No agentic loop; the pool is the stored `MatchRecord`s, so the scoring engine is never re-run.
- **No-fabrication guarantee:** the model only ever sees the tool output; citations resolve against *that* output's evidence, so it cannot cite — or claim — evidence it was never shown. Evidence items carry claim + quote + source + provenance, keeping answers traceable.
- **Weights-respecting pool:** the pool is ranked under the recruiter's current weights (`scoreOf`, default `DEFAULT_WEIGHTS`), so the agent agrees with the ranking the UI shows.
- **Blind mode:** the pool is the single anonymization point — `Candidate #N` labels, no name/file/contact reaches the model (§7).
- **Graceful degradation:** with no chat capability, or when the agent path throws, `deterministicAnswer` answers from the same pool with rule-based intents (compare, must-have, gaps, certification, by-name, skill-term) and still cites stored evidence. The `engine` field lets the UI label the answer as LLM agent or offline rules.
```

---

## 9. Visual Status Flags & Verified Skill Badges (`badge_service.py`)

- **Status Flags Engine**: Computes visual indicators based on candidate completeness, match scores, and text evidence:
  - 🟢 **Top Match**: Overall score ≥ 80 and skill score ≥ 75.
  - 👥 **Bench Candidate**: Overall score ≥ 60.
  - 🚀 **Immediate Joiner**: Detected regex availability snippet ("immediate", "0 days notice").
  - ⚠️ **Incomplete Profile**: Missing parsed experience or education data.
- **Skill Verification Engine**: Cross-references parsed skills against exact evidence snippets (confidence ≥ 70%) and linked public profiles (GitHub / LinkedIn) to assign verified skill badges.

---

## 10. L1 Preliminary Screening & Briefings (`screening_service.py`)

- **Adaptive Question Generation**: Synthesizes customized screening questions based on job requirement gaps and candidate background across Technical Depth, Problem Solving, and Behavioral/Collaboration categories.
- **Answer Evaluation**: Scores candidate responses (0–100) againstrubrics and evaluates communication depth.
- **Pre-Interview Briefing Pack**: Compiles an executive summary pack for technical interviewers (`summary_pack`) containing candidate scores and key interview focus areas.

---

## 11. JD Calibration & Requirement Optimization (`jd_optimizer.py`)

- **Coverage Analysis**: Analyzes candidate pool matches per job requirement to classify requirements:
  - `too_strict`: < 25% match rate on required skill (consider moving to nice-to-have).
  - `low_signal`: > 85% match rate on required skill (not differentiating pool).
  - `under_filtered`: < 25% match rate on nice-to-have skill (consider elevating to required).
  - `balanced`: Requirement is filtering pool as expected.
- **LLM Summary Generation**: Produces a concise recruiter guidance paragraph calibrating job description parameters.

---

## 12. Evaluating AI quality (when we add it)

Because the pipeline is split deterministic/AI, quality can be tuned without touching storage or UI contracts. Proposed harness (Phase 2+):
- **Fixture resumes** (synthetic + real, consented) with hand-labeled ground truth for skills/years/verdicts.
- **Regression tests** pinning parser accuracy and keyword/semantic thresholds.
- **Human review loop:** recruiters flag verdicts; flagged cases feed the prompt/schema corpus.
- Keep the schemas stable; treat any prompt change as a contract change requiring the fixture suite to pass.
