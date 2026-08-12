# ResumeIQ — AI Architecture

How intelligence is structured: the provider seams, prompts and schemas, the three-signal scoring model, cost controls, fallback behavior, and the copilot agent. Companion docs: [architecture.md](architecture.md) (overall design), [development.md](development.md) (local dev), [deployment.md](deployment.md) (deploy/ops).

> The implementation described here exists on `origin/Aasrith`. The checked-out branch is still the mock frontend — see the **Branch situation** section of `CLAUDE.md`.

---

## 1. Guiding principles

1. **LLM output is untrusted data.** Every model response is coerced and validated against a schema before it touches the domain. Never let raw output reach the UI or database.
2. **Deterministic first, AI-augmented.** Every score is computable without an LLM. AI refines and explains; it never replaces the auditable core.
3. **Evidence over assertion.** Every verdict cites a quoted source. Models are explicitly instructed to never claim evidence that is not in the resume.
4. **Cost-bounded by design.** Expensive per-candidate LLM calls run best-first over a configurable limit — never the whole pool.
5. **Graceful degradation is a product feature.** With no Azure credentials the app still works and labels which engine produced each result.

---

## 2. AI seams (where intelligence plugs in)

There are exactly three provider touch-points, all behind a `capabilities()` gate computed from config:

| Seam | Files | Function |
|---|---|---|
| **Document Intelligence** | `server/document-intelligence.ts` | OCR / text extraction for scanned resumes (`prebuilt-read`, async submit → poll) |
| **Chat** | `server/ai/` — `chatJson()` | Structured-output chat for parsing, JD analysis, candidate analysis |
| **Embeddings** | `server/ai/` — `embed()` | Semantic similarity for the matching signal, disk-cached |

`AzureCapabilities` (`{ documentIntelligence, chat, embeddings }`) is exposed to the UI so the frontend adapts (e.g. "offline parser" labels, disabling semantic features).

### Target: provider abstraction

Wrap chat/embeddings behind interfaces so the app never imports Azure directly:

```
ChatClient.            EmbeddingClient.
├── AzureOpenAI        ├── AzureOpenAI          (primary; api-key headers, deployment URLs)
└── OpenAICompat       └── OpenAICompat/OSS     (Ollama, vLLM, LM Studio — same REST contract)
```

Both implementations share the OpenAI-compatible REST shape. The reference's single `openai.ts` was split into the `server/ai/` seam (Step B): `types.ts` defines `ChatClient`/`EmbeddingClient`, `azure.ts` owns the REST transport + retry + JSON salvage, `chat.ts`/`embeddings.ts` are the Azure implementations, and `index.ts` holds lazy singletons. Swapping to an OSS provider now means adding a client factory in `index.ts` — nothing else changes. **OSS path (for dev/demos with no Azure budget):** self-hosted chat + embeddings and a Tesseract-class OCR replacing Document Intelligence.

## 3. Prompts & schemas

All three AI calls use **JSON-schema-constrained structured output**, degrade to `json_object` mode when the deployment rejects it, and salvage JSON from prose via a tolerant `extractJson()`. Models run at `temperature: 0`.

### 3.1 Resume parsing (`server/resume-parser.ts`)

**System prompt contract:** a resume-parsing engine for a recruiting platform. Rules the model must obey:
- Extract **exactly as written** — never invent, infer, or embellish.
- `""` or omit fields the resume does not state. Do not guess.
- `totalYearsExperience` = summed duration of professional roles (exclude internships < 6 months and education), one decimal.
- Skills must be concrete (technologies/tools/languages/methodologies) — **no soft-skill filler** like "team player".
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

**Safety layers:** `coerce()` sanitizes shape (wrong types → dropped, not crashed); `backfill()` fills contact details + tenure from regex when the model skipped them; if the model returns nothing usable, the **heuristic regex parser** is used and the engine is labelled `"heuristic"`.

### 3.2 JD analysis (`server/jd-analyzer.ts`)

**System prompt contract:** extract screening requirements. Rules:
- One requirement per distinct, checkable criterion.
- `category` ∈ `{Skills, Experience, Education, Certifications}` exactly.
- `text` ≤ 12 words, recruiter-readable (e.g. "5+ years backend engineering").
- `must = true` **only** when the JD states required/essential/minimum; `preferred/nice-to-have/bonus` → `false`.
- `keywords` = literal search terms incl. aliases ("Kubernetes" → kubernetes, k8s, eks, aks), 3–8 per requirement, lowercase.
- `minYears` only on Experience requirements that state a duration.
- Don't invent requirements; don't duplicate a criterion across categories.

**Output schema (abridged):**
```
{ title, summary, requirements: [{ category, text, must, keywords[], minYears? }] }
```

**Recruiter-editable by design:** every requirement can be rewritten, flipped MUST/NICE, deleted, or added. Editing invalidates the previous ranking (`store.clearMatches(jobId)`). The heuristic fallback (`heuristicRequirements`) is bullet/line based with MUST/NICE marker regexes.

### 3.3 Candidate analysis (`server/matching.ts`) — the scoring pass

**System prompt contract:** a technical recruiter assessing one candidate against one role; judge only on what the resume states.
- Per requirement id: `status ∈ {met, partial, missing}` + 0–100 score + one-line quoted evidence. **Never claim evidence that is not there.**
- `categoryScores`: 0–100 for skills/experience/education/certifications/projects reflecting fit **for this role**, not general quality.
- `strengths`/`gaps`/`transferable`: up to 3 each, evidence-backed.
- `evidence`: up to 5 `{skill, detail, source}` items where `source` names the role/project/cert it came from.
- `summary`: one sentence a recruiter could paste into a shortlist.

The resume is sent as a **compacted JSON projection** (truncated skills/experience/education) — not raw text — to keep tokens bounded.

---

## 4. The three-signal scoring model

Every category score blends three signals. This is the heart of the product.

| Signal | What it measures | Deterministic | Cost |
|---|---|---|---|
| **Keyword** | Requirement keywords matched against the **relevant resume section** (out-of-section hits count at `0.5`); tenure check for "N+ years" (`yearsSignal`) | ✅ | ~0 |
| **Semantic** | Cosine similarity between requirement text and per-category resume-section embeddings (Azure embeddings, **disk-cached**) | ✅ (embeddings) | low, cached |
| **AI** | Per-candidate LLM verdicts + category scores | ❌ | high — best-first, capped |

### 4.1 Keyword signal
- `matchesKeyword` guards word edges so "go" doesn't match "google" but allows `+ # .` inside tokens.
- Score = blend of best-single-hit (`40·best`) and coverage (`60·weighted/n`), capped at 100 — one strong hit already counts a lot; not every alias must match.
- A requirement found in a *different* section (e.g. "AWS" in a job bullet ≠ an AWS *certification* requirement) is weaker evidence.

### 4.2 Semantic signal
- Requirement and resume-section texts are embedded (batched ≤ 16, truncated to 8k chars), cached by SHA-1 hash in `embeddings.json`.
- Raw cosine is **normalized onto a 0–100 scale**: unrelated technical prose ≈ `0.15`, solid match ≈ `0.55` → `((cosine − 0.15) / 0.4) × 100`. Calibration depends on the embedding model — re-check on model change.
- Projects (no requirements of their own) are measured against the whole role.

### 4.3 AI signal & blending
- Blend weights shift when the AI signal is absent:

| Signals available | Weights |
|---|---|
| keyword + semantic (no AI) | `0.6 / 0.4` |
| keyword + semantic + AI | `0.3 / 0.2 / 0.5` |

- Per-requirement verdicts prefer the LLM's `met/partial/missing` when present; otherwise derived from the keyword score (`≥70 met, ≥35 partial, else missing`).
- Must-have accounting: `mustHavesMet` / `mustHavesTotal` computed per candidate.

### 4.4 Ranking & explainability
- **Raw category scores are stored** (`MatchRecord.categories`) — recruiter `Weights` are applied **client-side** for instant re-ranking without recomputation (`scoreOf`/`rankCandidates` in `src/lib/types.ts`).
- Every rendered score/verdict surfaces its evidence: per-requirement coverage, signal breakdown, and quoted sources.

---

## 5. Cost model & budget controls

The deterministic/AI split is what keeps cost sane:

1. **Deterministic pass scores the whole pool** (keyword + cached embeddings) — near-zero marginal cost.
2. **LLM pass runs best-first** over the top `SCREENING_AI_ANALYSIS_LIMIT` candidates (default 50), with `SCREENING_CONCURRENCY` parallel analyses.
3. **Embeddings are cached on disk** — re-screening the same pool is nearly free; a requirement edit only re-embeds the changed text.
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

- Blind mode is a **UI toggle** in the ranking/comparison views, and for the **copilot it is a hard guarantee**: the pool the agent and the deterministic fallback operate on is built from an anonymized projection — labels become `Candidate #N` (rank-based), and no name, filename, or contact detail reaches the model. Name lookups are disabled against the anonymized pool.
- The screening/analysis pass itself still runs on full resumes (blind mode is recruiters hiding identity, not hiding data from the AI); if that guarantee is ever required, PII must be stripped from the compacted projection before the AI pass (see architecture.md §12).

## 8. Copilot agent

Implemented as a **bounded two-step tool-using agent** (`src/lib/server/copilot.ts`, entry `copilotAnswer`, RPC `copilotAsk`):

```
Recruiter question + jobId + weights + blind flag
   → step 1: model selects ONE tool (structured output, copilotToolCallSchema)
   → tool runs against the STORE-backed pool:
       search_candidates(query | skill | minYears | level)
       get_verdicts(candidateId)
       compare(candidateIds[])
       gap_summary()
       must_have_report()
   → step 2: model writes the answer, citing evidence by id (copilotAnswerSchema)
   → server resolves ids ONLY against the evidence the tool actually returned
   → response: { answer, citations[], tools[], engine: "agent" | "deterministic" }
```

- **Bounded by design:** at most two chat calls (tool selection ≈400 tokens, answer ≈800 tokens). No agentic loop; the pool is the stored `MatchRecord`s, so the scoring engine is never re-run.
- **No-fabrication guarantee:** the model only ever sees the tool output; citations resolve against *that* output's evidence, so it cannot cite — or claim — evidence it was never shown. Evidence items carry claim + quote + source + provenance, keeping answers traceable.
- **Weights-respecting pool:** the pool is ranked under the recruiter's current weights (`scoreOf`, default `DEFAULT_WEIGHTS`), so the agent agrees with the ranking the UI shows.
- **Blind mode:** the pool is the single anonymization point — `Candidate #N` labels, no name/file/contact reaches the model (§7).
- **Graceful degradation:** with no chat capability, or when the agent path throws, `deterministicAnswer` answers from the same pool with rule-based intents (compare, must-have, gaps, certification, by-name, skill-term) and still cites stored evidence. The `engine` field lets the UI label the answer as LLM agent or offline rules.

## 9. Evaluating AI quality (when we add it)

Because the pipeline is split deterministic/AI, quality can be tuned without touching storage or UI contracts. Proposed harness (Phase 2+):
- **Fixture resumes** (synthetic + real, consented) with hand-labeled ground truth for skills/years/verdicts.
- **Regression tests** pinning parser accuracy and keyword/semantic thresholds.
- **Human review loop:** recruiters flag verdicts; flagged cases feed the prompt/schema corpus.
- Keep the schemas stable; treat any prompt change as a contract change requiring the fixture suite to pass.
