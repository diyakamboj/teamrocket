# ResumeIQ — Development Guide

How to set up, run, extend, and contribute to this repository. Companion docs: [architecture.md](architecture.md) (target design), [ai-architecture.md](ai-architecture.md) (AI pipeline), [deployment.md](deployment.md) (deploy/ops).

> **Working tree status (as of writing):** the checked-out branch is the frontend-only mock. The Azure-backed implementation lives on `origin/Aasrith`. See **Branch context** below and the **Branch situation** section of `CLAUDE.md`.

---

## 1. Prerequisites

- **Bun** (package manager + task runner — `bun.lock` is the lockfile). Node is fine for running the app but Bun is what the repo is set up with.
- Node 20+ for tooling.
- No Azure account required for development — the app runs fully in **offline mode** (§5) with reduced quality.

## 2. Setup

```bash
bun install            # install dependencies
cp .env.example .env   # only needed for Azure-backed features; see §4
bun run dev            # start dev server → http://localhost:8080
```

The app is a TanStack Start SSR app. `bun run dev` starts the Vite dev server; server functions (`createServerFn`) run in the same process during development.

## 3. Commands

| Command | Purpose |
|---|---|
| `bun run dev` | Start the dev server (port **8080**) with hot reload |
| `bun run build` | Production build (`vite build`, nitro server target) |
| `bun run build:dev` | Build in development mode |
| `bun run preview` | Preview a production build locally |
| `bun run lint` | ESLint over the repo |
| `bun run format` | Prettier write |
| `bun run test` | Vitest run — unit tests for server logic (see §8) |

There is no standalone `tsc` script; type errors surface through Vite/the editor and `bun run build`.

## 4. Environment variables

Copy `.env.example` → `.env`. Everything is **read server-side only** and never reaches the browser bundle (the server config loader in `src/lib/server/config.ts` loads `.env`/`.env.local` into `process.env`; real environment variables win over file contents). Only `VITE_`-prefixed vars are exposed client-side.

| Variable | Purpose |
|---|---|
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` / `_KEY` | OCR/text extraction for scanned or non-PDF resumes |
| `AZURE_DOCUMENT_INTELLIGENCE_API_VERSION` | Default `2024-11-30` (newer `/documentintelligence/*` path; falls back to legacy `/formrecognizer` on 404) |
| `AZURE_DOCUMENT_INTELLIGENCE_MODEL` | Default `prebuilt-read` |
| `AZURE_OPENAI_ENDPOINT` / `_API_KEY` | Chat + embeddings |
| `AZURE_OPENAI_DEPLOYMENT` | Chat model deployment (e.g. `gpt-4o-mini`) |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Embedding model deployment (e.g. `text-embedding-3-small`) |
| `AZURE_OPENAI_API_VERSION` | Default `2024-10-21` |
| `RESUME_PIPELINE_CONCURRENCY` | Docs processed in parallel during ingestion (default `4`) |
| `RESUME_MAX_FILE_BYTES` | Per-file upload cap (default `20 * 1024 * 1024`) |
| `SCREENING_AI_ANALYSIS_LIMIT` | Candidates that get the expensive per-candidate LLM pass, best-first (default `50`) |
| `SCREENING_CONCURRENCY` | Parallel LLM analyses during screening (default `4`) |
| `RESUMEIQ_DATA_DIR` | Where the file store lives (default `.data/`) |

## 5. Offline mode (no Azure credentials)

The app is fully usable without Azure, with reduced quality, and **always says which engine produced a result**:

- **PDFs with a text layer** are read by the built-in extractor (`src/lib/server/pdf-text.ts`). Scanned PDFs, images, and DOCX fail with a message naming the missing env vars.
- **Resume parsing & JD analysis** fall back to a keyword/regex parser, labelled `"heuristic"` in the UI.
- **Matching** runs on the keyword signal alone when embeddings and chat are unavailable.

**Try it without uploading:** when the pool is empty, the dashboard and candidate pages offer a **"Try the demo"** button (`src/lib/server/demo.ts`). It loads 8 synthetic resumes and a sample backend-engineer JD, then runs the *real* offline pipeline (heuristic parse → heuristic JD analysis → keyword-only screening) and persists the result through the store — so demo data is genuine pipeline output, not mock data, and keeps the engine labels (§4's honesty rule). The header search box navigates to `/candidates?q=…` and filters the pool.

Rule for contributors: **do not break offline mode.** Every AI/Azure path must have a graceful fallback (see the `capabilities()` pattern in `config.ts` and the `engine`/`analyzedBy` labels).

## 6. Extending the app

### 6.1 Add a route

TanStack Start uses **file-based routing** in `src/routes/`:

| File | URL |
|---|---|
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `users/$id.tsx` | `/users/:id` (bare `$`, no curly braces) |
| `_layout.tsx` | layout route (children via `<Outlet />`) |
| `__root.tsx` | app shell — wraps every page; keep `<Outlet />` |

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [{ title: "About — ResumeIQ" }],
  }),
  component: AboutPage,
});

function AboutPage() {
  return <main>…</main>;
}
```

- `src/routeTree.gen.ts` is auto-generated — **never edit it by hand**. It regenerates when you add a route.
- Do **not** use Next.js/Remix conventions (`src/pages/`, `app/layout.tsx`).
- Wire shared UI state through `useAppState()` from `@/lib/app-state`; route-level data through TanStack Query.

### 6.2 Add a server function (backend RPC)

Server functions are the web↔server contract (on the `Aasrith` branch; this is the pattern to follow):

```ts
import { createServerFn } from "@tanstack/react-start";

export const myAction = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<MySnapshot> => {
    // Server-only code. Import the backend dynamically so it never ships to the client:
    const be = await import("@/lib/server");
    return be.doThing(data.id);
  });
```

**Critical rule:** server modules (`src/lib/server/*`) must be imported dynamically **inside** handler bodies. A shared top-level import defeats the compiler's client-bundle stripping (an import-protection plugin rejects it). See the comment block in `src/lib/api/jobs.ts`.

### 6.3 Add a shared type

Cross-boundary types live in `src/lib/types.ts` (client-safe — no Node built-ins). Extend it when a contract changes between web, API, worker, and AI engine; keep scoring helpers (`scoreOf`, `rankCandidates`, `levelFromYears`) there so client and server agree.

## 7. Code style

- **TypeScript strict** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`. Array access yields `T | undefined` — use non-null assertions (`arr[0]!`) and `?.`/`??` as the existing code does.
- **No `any`** — use `unknown` + narrowing, explicit unions, `as const` for literals.
- **Path alias `@/`** → `src/` (e.g. `@/lib/utils`, `@/components/ui/button`).
- **Classnames** via `cn()` from `@/lib/utils` (Tailwind merge).
- **UI** via shadcn/ui primitives (`@/components/ui/*`, Radix + CVA + Tailwind v4). Design tokens via CSS variables (`bg-primary`, `text-muted-foreground`, `var(--border)`).
- **Comments explain *why*, not *what*** — the codebase documents non-obvious decisions (dynamic imports, h3 error normalization, the store singleton). Continue that.
- **Model output is untrusted:** coerce with explicit helpers (`str`, `strArray`, `numOr`, `coerce`) — replicate the pattern from `resume-parser.ts`/`matching.ts`.
- **Named exports** for functions/components; route components are PascalCase function components.

## 8. Testing

**Vitest** is the runner (`bun run test` = `vitest run`, `bun run test:watch` for watch mode). Config lives in `vitest.config.ts`: Node environment, the `@/` → `src/` alias, `src/**/*.test.ts` included, env stubs restored per test (`unstubEnvs`).

Coverage today (Steps C–G): the resume parsing, JD analysis, scoring, copilot producers, and the demo seed.
- `resume-parser.test.ts` — heuristic parser against a fixture resume (contact, skills, experience/dates, tenure) and `coerceParsedResume` robustness against messy/garbage model output.
- `resume-parser.llm.test.ts` — the Azure path with a mocked chat seam: well-formed output is validated through `parsedResumeSchema`; empty output degrades to the heuristic parser.
- `jd-analyzer.test.ts` — heuristic JD analysis (`heuristicRequirements` categories/must/minYears, `deriveKeywords` stop-word filtering and capping), the offline `analyzeJobDescription` path, and `coerceJobAnalysis` robustness against messy/garbage model output.
- `jd-analyzer.llm.test.ts` — the Azure path with a mocked chat seam: validated requirements flow through `jobRecordSchema`; empty output degrades to the heuristic parser.
- `matching.test.ts` — the three signals (`keywordSignal` in-category/alias/out-of-section weighting, `yearsSignal` tenure math, `blend` with and without AI), `coerceAiAnalysis` robustness, and the offline `screen` path emitting the frozen `MatchRecord` shape (score explanation, nested must-haves, citable verdicts with provenance).
- `types.test.ts` — the client/server-shared scoring helpers on frozen candidates: `scoreOf` weighting, `rankCandidates` sort/tie-break/non-mutation, `scoreBuckets` ranges.
- `config.test.ts` — `capabilities()` reports all-offline when unconfigured.
- `copilot.test.ts` — the copilot agent over a mocked store/chat seam: pool building (ranking, tie-breaks, blind anonymization, incomplete-resume skips), each tool (`searchCandidates`, `getVerdicts`, `compare`, `gapSummary`, `mustHaveReport`), untrusted-arg coercion, the deterministic fallback intents, and the agent path — including the no-fabrication guarantee that citations resolve only against the evidence the tool actually passed to the model.
- `azure.test.ts` — `extractJson` (plain, fenced, prose-wrapped) and the typed `AzureOpenAIError` when salvage fails.

All producers (Steps C–G) now have coverage; the explain endpoint's `explainCandidate` server fn (Step E) is wired through `src/lib/api/jobs.ts` and exercised by the candidates route.
- `demo.test.ts` — offline smoke test of the demo seed: with capabilities all-offline and the AI seam mocked, every fixture resume parses into a complete, schema-valid record, the pool screens into a believable, differentiated ranking with keyword-backed verdicts, `loadDemoData` resets and persists the batch as a finished run, and no LLM/embedding call ever fires.

Write new logic as pure functions with explicit inputs so tests stay mocking-light.

## 9. Contribution workflow

1. **Start from the current state** — confirm the branch and check `git show origin/Aasrith:<path>` before writing any backend/parser/matching/AI logic: the reference implementation may already cover it.
2. Keep the working branch in a working state at all times.
3. **Lovable constraint:** never rewrite published git history — no force-push, rebase, amend, or squash of already-pushed commits (`AGENTS.md`). Create new commits.
4. Run `bun run lint` and a build before considering work done.
5. Update docs when contracts or boundaries change (`docs/*` + the schema in `src/lib/types.ts`).

## 10. Common gotchas

- **Editing `routeTree.gen.ts`** — don't; it's generated.
- **Server modules in the client bundle** — imports of `node:*`, Azure, or secrets must stay behind dynamic imports in server-function bodies.
- **Env vars in the browser** — only `VITE_*` is available client-side; secrets go through `config.ts` server-side.
- **The `.data/` file store** — a dev/demo persistence layer (single-process). Do not rely on it in production; it's being replaced by Cosmos DB + Blob Storage.
- **`venv/`** — an empty orphaned Python virtualenv; not part of the app. Do not assume it's a live backend.
- **Changing the scoring model** — it is shared between client and server (`src/lib/types.ts`). Changing weights is safe; changing category semantics breaks stored `MatchRecord`s.
