# ResumeIQ ΓÇö Deployment Guide

How the app is (or will be) deployed to Azure: environments, Terraform-managed resources, CI/CD, secrets, the queue/worker, data migrations, and runbooks. Companion docs: [architecture.md](architecture.md) (target design), [development.md](development.md) (local dev), [ai-architecture.md](ai-architecture.md) (AI pipeline).

> **Status:** Target design. **None of this is built yet** ΓÇö there is no Dockerfile, no Terraform, and no CI/CD in the repository today. The app currently runs via `bun run dev` on a developer machine, using a JSON-file store (`.data/`). This document is the plan for production.

---

## 1. Target topology (single region first)

```
Azure Subscription
ΓööΓöÇΓöÇ Resource Group "rg-resumeiq-<env>"
    Γö£ΓöÇΓöÇ Web app        (TanStack Start SSR)   ΓÇö Container App (or App Service)
    Γö£ΓöÇΓöÇ API service    (REST)                 ΓÇö Container App
    Γö£ΓöÇΓöÇ Worker         (queue consumer)       ΓÇö Container App (scale on queue depth)
    Γö£ΓöÇΓöÇ Cosmos DB      (NoSQL)                ΓÇö resumes / jobs / matches / runs
    Γö£ΓöÇΓöÇ Storage account                       ΓÇö private blob container `resumes`
    Γö£ΓöÇΓöÇ Key Vault                             ΓÇö OpenAI/DI keys, DB connection strings
    Γö£ΓöÇΓöÇ Azure OpenAI                          ΓÇö chat + embeddings deployments
    Γö£ΓöÇΓöÇ Azure AI Document Intelligence        ΓÇö OCR
    Γö£ΓöÇΓöÇ Log Analytics + Application Insights  ΓÇö logs, metrics, traces
    ΓööΓöÇΓöÇ (later) Azure AI Search, Azure Front Door + WAF
```

**Hosting recommendation:** Azure **Container Apps** ΓÇö managed, worker-friendly (scale-to-zero in dev, scale on queue depth in prod), supports the Node runtime the app actually needs. Cloudflare Workers (the current nitro default target) is *not* the target: the server code uses `node:fs`, `node:zlib`, `node:crypto`, and background work that doesn't fit a short-lived serverless request lifecycle.

## 2. Environments

| Env | Purpose | Protection |
|---|---|---|
| `dev` | Team integration, offline-mode testing | Deploys on merge to `main`; auto-approved |
| `staging` | Pre-prod validation with real (non-prod) Azure AI resources | Manual approval; seeded synthetic data |
| `prod` | Real recruiters | Manual approval + lock; `prevent_destroy` on data resources |

Each env is its own resource group with its own Azure OpenAI/Document Intelligence instances so cost and quotas don't collide.

## 3. Terraform (target layout)

```
infra/
Γö£ΓöÇΓöÇ environments/
Γöé   Γö£ΓöÇΓöÇ dev/      backend.tf, terraform.tfvars, versions.tf
Γöé   Γö£ΓöÇΓöÇ staging/  ...
Γöé   ΓööΓöÇΓöÇ prod/     ...
Γö£ΓöÇΓöÇ modules/
Γöé   Γö£ΓöÇΓöÇ web/             container app, DNS, ingress
Γöé   Γö£ΓöÇΓöÇ api/             container app, config
Γöé   Γö£ΓöÇΓöÇ worker/          container app + queue wiring
Γöé   Γö£ΓöÇΓöÇ data/            cosmos db, storage, key vault
Γöé   Γö£ΓöÇΓöÇ ai/              openai + document intelligence
Γöé   ΓööΓöÇΓöÇ observability/   log analytics, app insights
ΓööΓöÇΓöÇ main.tf              remote state (Azure Storage + locking)
```

- **Remote state** in a versioned storage container with blob lease locking.
- **No secrets in state:** all secrets are Key Vault references resolved via **user-assigned managed identity**; role assignments (`azurerm_role_assignment`) grant least privilege per service.
- Naming convention: `rg-resumeiq-<env>`, `app-web-<env>`, `cosmos-resumeiq-<env>`, `kv-resumeiq-<env>`, etc. Tag everything with `env`, `app=resumeiq`, `owner`, `cost-center`.
- Data resources in `prod` carry `lifecycle { prevent_destroy = true }`; the AI module enables purge-protection so OpenAI/DI can't be accidentally destroyed (deployments are quota-constrained).

## 4. CI/CD (GitHub Actions ΓÇö target)

```
on:
  push: [main]
  pull_request: [...]
jobs:
  ci:                       # PR + push
    bun install
    bun run lint
    bun run build           # type-check + production build
    bun test                # once the Vitest suite exists
  cd-dev:                   # on merge to main
    terraform plan/apply (dev)
    docker build + push web/api/worker ΓåÆ ACR
    deploy to Container Apps (dev)
    smoke test (offline + capabilities endpoint)
  cd-staging:               # manual trigger
    ΓÇª same, against staging
  cd-prod:                  # manual approval gate
    ΓÇª same, against prod
  nightly:                  # scheduled
    cost check, health check, token-budget check
```

Quality gates before merge: lint clean, tests green, build passes, docs updated if contracts changed. **Every `createServerFn`/API contract change must update `src/lib/types.ts` and be reflected in these docs.**

## 5. Secrets & configuration

| Kind | Mechanism |
|---|---|
| Secrets (Azure keys, DB conn strings) | Azure **Key Vault**, injected via managed identity at boot |
| Non-secret tuning | env vars at the Container App level (the reference `config.ts` already centralizes them) |
| Client-visible | only `VITE_*` non-secrets; server-side secrets never reach the browser bundle |

The config loader in `src/lib/server/config.ts` already enforces "real env wins over `.env` files" ΓÇö preserve that invariant in production (no `.env` on the server; all values come from the environment the platform injects).

## 6. The worker & queue (non-negotiable for production)

Today the ingestion pipeline and screening run **in-process** (`server/pipeline.ts`, `server/screening.ts`) with a `void async` background task. This does not survive a serverless or restarted request lifecycle and couples job runtime to the web process.

**Target:**
- **Azure Queue Storage** (or Service Bus) as the durable job queue: `ingest-{fileId}`, `screen-{jobId}`.
- **Worker** Container App drains the queue, updates stage/progress in Cosmos DB.
- `ScreeningRun` status lives in the DB; the API/UI poll it (the reference already exposes progress via `runScreening` ΓåÆ `store.saveRun`).
- Idempotent stages + at-least-once delivery: a crashed worker resumes from the last recorded stage.

## 7. Data migrations

**Source of truth today:** `.data/store.json` + `.data/uploads/` + `.data/embeddings.json` (single-process, unencrypted ΓÇö dev/demo only).

**Migration path (Phase 1):**
1. Implement Cosmos DB + Blob Storage behind the `store.ts` interface (no change to callers).
2. One-time script: read `.data/store.json` ΓåÆ write `ResumeRecord`/`JobRecord`/`MatchRecord`/`ScreeningRun` to Cosmos; copy `uploads/*.bin` ΓåÆ blob container `resumes` keyed by record id.
3. Decommission `.data/`; keep the migration script in `infra/scripts/` for reference.
4. `embeddings.json` ΓåÆ Cosmos container or (later) Azure AI Search vector index.

Schema versioning: add a `schemaVersion` field to records; run backward-compatible migrations in the deploy step before rollout (forward-compatible reads during rollback window).

## 8. Observability

- **Logs:** structured JSON with a correlation id per request/run. Key boundaries: ingest, each pipeline stage, each Azure call (tokens, latency, status), screening progress.
- **Metrics:** upload throughput, parse success rate, DI/OpenAI latency, screening run duration, token cost per run, queue depth.
- **Traces:** distributed tracing web ΓåÆ API ΓåÆ worker ΓåÆ AI (App Insights).
- **Alerts:** run failure rate, queue backlog, Azure 429 throttling, per-run token budget breach, any production exception.

## 9. Runbooks

### Deploy a release
1. Merge to `main` ΓåÆ CI green ΓåÆ `cd-dev` auto-deploys dev.
2. Trigger `cd-staging`; validate offline mode + capabilities + one real screening run against synthetic resumes.
3. Trigger `cd-prod` (approval required); smoke test; watch token/cost dashboards for 24h.

### Roll back
- **App code:** redeploy the previous image tag (images are immutable in ACR; keep last N tags).
- **Data:** Cosmos point-in-time restore / blob soft-delete retention (enable before first prod data).
- **Config:** revert env at the Container App level ΓÇö no code deploy needed.

### Incident: AI cost spike
1. Circuit-break per-run token budget (env cap) or disable the AI pass (`SCREENING_AI_ANALYSIS_LIMIT=0` ΓåÆ deterministic-only).
2. Identify the run in App Insights by correlation id; check the nightly token report.
3. Raise the gate (fewer candidates, cheaper model tier) before re-enabling.

### Incident: Azure 429 throttling
The reference `requestWithRetry` honors `Retry-After`. Verify worker concurrency and DI S0 quota; reduce `RESUME_PIPELINE_CONCURRENCY`/`SCREENING_CONCURRENCY` or provision a higher tier.

### Health checks
- `/capabilities` endpoint ΓåÆ confirms engines, storage, and secret wiring on each env.
- Scheduled nightly job verifies all three deployments are healthy and reports cost.

## 10. Cost posture

- Document Intelligence S0 tier; OpenAI deployments quota-limited (not unlimited).
- Deterministic-first design means the LLM only runs on the top-N shortlist ΓÇö cap via `SCREENING_AI_ANALYSIS_LIMIT`, monitor per-run tokens.
- Worker scale-to-zero when idle in `dev`; prod worker scales on queue depth.
- Review the nightly cost report before Phase 3 sign-off (infra spend is the TPM's call).
