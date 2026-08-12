# ResumeIQ

AI resume screening for recruiters: bulk-upload resumes, extract structured data with
Azure AI Document Intelligence + Azure OpenAI, turn a job description into editable
requirements, and rank candidates against them.

## Running it

```bash
npm install && npm run dev
```

The app runs on http://localhost:8080. Copy `.env.example` to `.env` and fill in your
Azure credentials — everything is read server-side only and never reaches the browser.

## Features

### Bulk resume upload

Drop files or whole folders onto `/upload`. Each file is uploaded, stored, and pushed
through the pipeline independently, with live per-file status (`Queued → Uploading →
Reading text → OCR → AI Parsing → Complete`). Uploads are sent in batches of 15 and
processed with a configurable concurrency limit.

Per-file handling:

- **Duplicates** are detected by SHA-256 content hash, not filename, and can be skipped
  or processed anyway.
- **Failures** show the actual reason (password-protected, no text layer, unsupported
  format, Azure error) and can be retried individually or in bulk.
- **Scanned documents** are detected by checking for a usable embedded text layer; those
  without one are routed through OCR and flagged `Scanned` in the list.

### AI resume parsing

Text extraction runs through **Azure AI Document Intelligence** (`prebuilt-read`), which
OCRs scanned pages transparently. The extracted text goes to **Azure OpenAI** with a
JSON-schema-constrained prompt that pulls out contact details, skills (with the evidence
backing each one), work experience, education, certifications and projects.

### Job description analysis

Paste a description into `/job-analysis` and Azure OpenAI extracts discrete, checkable
requirements categorised as Skills / Experience / Education / Certifications, each with
must-have vs nice-to-have classification, keyword aliases for the matching pass, and a
minimum-years figure where the description states one. Every requirement is editable —
recruiters can rewrite the text, flip MUST/NICE, delete, or add their own before
screening. Editing requirements invalidates the previous ranking.

### Candidate matching & ranking

Each candidate is scored per category by blending three signals:

| Signal | How it works |
| --- | --- |
| Keyword | Requirement keywords matched against the relevant resume section. Matches outside that section count at half weight. |
| Semantic | Cosine similarity between requirement and resume-section embeddings (Azure OpenAI embeddings), cached on disk. |
| AI | Per-candidate LLM analysis: per-requirement met/partial/missing verdicts with quoted evidence, category scores, strengths, gaps, transferable skills. |

Deterministic signals score the whole pool; the LLM pass then runs best-first over the
top `SCREENING_AI_ANALYSIS_LIMIT` candidates (default 50) to keep cost bounded. The
ranking page shows an overall score, the category breakdown, must-haves met, and an
expandable per-requirement coverage view. Category weights are adjustable and re-rank
instantly; blind-review mode hides names and contact details.

## Running without Azure credentials

The app is fully usable without Azure, with reduced quality, and always says which
engine produced a result:

- PDFs **with** a text layer are read by a built-in extractor; scanned PDFs, images and
  DOCX fail with a message naming the missing environment variables.
- Resume parsing and JD analysis fall back to a keyword/regex parser (labelled
  "offline parser" in the UI).
- Matching runs on the keyword signal alone when embeddings and chat are unavailable.

## Try it without uploading

When the pool is empty, the dashboard and candidate-ranking pages offer a **"Try the
demo"** button. It loads eight synthetic resumes plus a sample backend-engineer job
description and runs them through the real offline pipeline — heuristic parsing, JD
analysis and keyword-only screening — so you can explore ranking, category weights,
must-have coverage and the explain view before uploading anything. Demo results are
stored like any real batch and keep the engine labels, so it is honest pipeline output
rather than mock data.

## Architecture

- `src/lib/server/*` — server-only: Azure clients, ingestion pipeline, parsers, matching
  engine, and a JSON-file-backed store (`.data/`, gitignored).
- `src/lib/api/*` — `createServerFn` endpoints. Server modules are imported dynamically
  *inside* handler bodies so the compiler strips them from the client bundle.
- `src/lib/types.ts` — types and scoring helpers shared by client and server.
- `src/routes/*` — pages; all data comes from the server functions via React Query.

### Deployment note

Nitro is configured for a Cloudflare Workers target by default. The server code uses
`node:fs`, `node:zlib` and `node:crypto` (file-backed store, PDF text extraction,
content hashing), so deploying there needs `nodejs_compat` — or swap the store for a
KV/R2-backed implementation. It runs as-is on any Node host.
