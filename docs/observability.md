# ResumeIQ — Observability & Ops Health Dashboard

How ResumeIQ is monitored after deployment: what's tracked, why each metric matters, how to read the `/ops` dashboard, the alert rules that page someone, and the runbooks for the failure modes those alerts cover. Companion docs: [architecture.md](architecture.md) (system layout), [ai-architecture.md](ai-architecture.md) (AI seams the AI Services tab instruments), [deployment.md](deployment.md) (Azure topology).

> **Status: Phase 1**, built incrementally. Everything below is live and testable locally in mock mode with no Azure deployment. Section 7 lists what's deliberately deferred and why.

---

## 1. Two complementary layers

| Layer | What it is | Where it lives | When it's useful |
|---|---|---|---|
| **In-app Ops dashboard** | `/ops` page in the ResumeIQ frontend, backed by `GET /api/ops/*` on the backend | `frontend/src/routes/ops.tsx`, `backend/app/routes/ops.py` | Day-to-day: "is the app healthy right now," debugging a specific failing endpoint or AI call, works with zero Azure Monitor setup |
| **Azure Monitor** (Application Insights + Log Analytics) | Platform-level telemetry and alert rules on the actual deployed Azure resources | `infra/terraform/monitoring.tf`, `alerts.tf` | Incident response once deployed: paging, cross-service traces, resource-level metrics (CPU, App Service platform errors) that survive even if the app itself is down |

The in-app dashboard's data source (`backend/app/services/sre_events.py`) is a lightweight blob-backed event store the backend writes to directly — it is **not** Azure Monitor and doesn't require deployment to work; it's what makes the dashboard useful in local dev. Azure Monitor is the production safety net that still functions if the app is too broken to serve its own dashboard.

---

## 2. What's monitored, and why

### Application Health (`/ops` → Application Health tab)
- **Request volume, error rate, avg/p95 latency**, bucketed every 5 minutes.
- **Why it matters**: this is the first thing to check when someone says "the app is slow/broken." A spike in error rate isolates *when* something broke; p95 latency (not just average) catches the case where most requests are fine but a subset are hanging — averages hide that.
- **Source**: `app/middleware.py`'s `RequestContextMiddleware` times every request and records one event per request. `/api/ops/*` and `/health` are excluded from their own counts so polling the dashboard doesn't skew the numbers.

### AI Service Monitoring (`/ops` → AI Services tab)
- **Per-service call count, failure count, fallback count, latency, mock-vs-live %, circuit breaker state** for Azure OpenAI (chat), Azure OpenAI (embeddings), and Azure AI Document Intelligence.
- **Why it matters**: ResumeIQ's core value (parsing, scoring, the copilot) depends entirely on these three services. When Azure OpenAI is down or throttling, everything should *degrade gracefully* to deterministic/mock logic rather than 500 — this tab is how you confirm that's actually happening versus silently failing. The circuit breaker state (`Open`/`Closed`) tells you whether the app has already given up retrying a dead endpoint (by design — see `azure_services.py`'s `AzureOpenAIService`) so you're not chasing a problem the app already worked around.
- **Azure AI Search is intentionally not tracked yet** — there's no live query call site in the app today, only a fire-and-forget candidate upsert. Nothing to show until that changes.

### Agent / API Monitoring (`/ops` → Agent Monitoring tab)
- **Total copilot turns, deterministic vs. LLM-agent split, fallback rate, tool usage breakdown.**
- **Why it matters**: the recruiter copilot silently falls back to deterministic answers on any agent-path failure (`copilot_agent.py`'s `copilot_answer`) — before this dashboard existed, that fallback was **completely unlogged**, so a broken agent path looked identical to normal deterministic-mode operation. A rising fallback rate is the leading indicator that Azure OpenAI (or the tool-selection prompt) is failing even though users don't see an error.

### Logging & Diagnostics (`/ops` → Diagnostics tab)
- **Every recorded event** (HTTP requests, AI calls, agent turns), newest first, filterable by status (`success` / `failure` / `fallback`).
- **Why it matters**: this is the "trace a failure from the frontend through the backend to the Azure dependency" view in one place — when a recruiter reports a broken upload or a bad copilot answer, filter to `failure`/`fallback` and find the specific event with its error message and timestamp, then correlate against Application Insights (once deployed) for the full distributed trace.
- **Local-mode note**: this is a substitute for real Log Analytics KQL search, which needs live Azure telemetry to be useful — see Section 7.

### Operational Overview (`/ops` → Overview tab)
- **Healthy / Degraded / Critical** rollup, overall and per service (`backend`, `ai_services`, `copilot_agent`).
- **Why it matters**: the one glance that answers "do I need to look at anything right now." Thresholds are intentionally simple and hardcoded in `backend/app/services/sre_metrics_service.py` (see the table below) — tune them there as real traffic patterns emerge.

| Service | Degraded | Critical |
|---|---|---|
| Backend API | error rate ≥ 1% | error rate ≥ 10% |
| Azure OpenAI (chat/embeddings) | failure rate ≥ 20% | circuit breaker open |
| Document Intelligence | failure rate ≥ 20% | failure rate ≥ 50% |
| Copilot agent | fallback rate ≥ 20% | fallback rate ≥ 50% |

### Performance Monitoring
- Covered today via the Application Health tab's p95 latency and the AI Services tab's per-service latency — enough to spot a slow endpoint or a slow AI dependency in the moment. There is **no historical baseline/trend store yet** (see Section 7) — `hours` is a live window (1–24h), not a rolling comparison against "normal."

### Infrastructure Monitoring
- **App Service and App Service Plan platform metrics** (HTTP 5xx, response time, CPU) via the Terraform alert rules in Section 4 — these fire even if the backend process itself is unresponsive, which the in-app dashboard by definition cannot detect about itself.
- **Deeper resource-level monitoring** (Blob Storage, Key Vault throttling, Document Intelligence quota) is deferred — see Section 7.

### Deployment / CI-CD Visibility
- **Deferred to a later phase** — see Section 7.

---

## 3. Using the dashboard

Open `/ops` in the frontend (nav: **Ops Health**). It polls every 15 seconds over a 1-hour window. No Azure credentials or deployment are required — it works against `USE_MOCK_AZURE=true` local dev, because every AI call site records an event even in mock mode (that's deliberate: it's the only way the dashboard shows data for the common local-dev case).

```bash
# Backend must be running (see root CLAUDE.md for full setup)
curl http://localhost:8000/api/ops/overview
curl http://localhost:8000/api/ops/requests?hours=1
curl http://localhost:8000/api/ops/ai-services?hours=1
curl http://localhost:8000/api/ops/agent?hours=1
curl "http://localhost:8000/api/ops/logs?hours=1&status=failure"
```

---

## 4. Alerts (`infra/terraform/alerts.tf`)

Four `azurerm_monitor_metric_alert` rules, all wired to one `azurerm_monitor_action_group` (`ag-resumeiq-<env>`):

| Alert | Signal | Threshold | Severity |
|---|---|---|---|
| `backend_http_5xx` | App Service `Http5xx` (Total) | > 10 / 5 min | 1 |
| `backend_response_time` | App Service `ResponseTime` (Average) | > 5s / 15 min | 2 |
| `backend_cpu_high` | App Service Plan `CpuPercentage` (Average) | > 85% / 15 min | 2 |
| `app_insights_failed_requests` | App Insights `requests/failed` (Count) | > 5 / 15 min | 1 |

**These fire and are visible in the Azure Portal regardless of configuration.** Whether anyone gets emailed is controlled separately by `var.alert_notification_email` (empty by default — no team inbox has been decided yet). Set it in a `.tfvars` file or via `terraform apply -var="alert_notification_email=..."` to wire up notifications without touching any other Terraform.

These are platform-level alerts, deliberately scoped to signals Azure Monitor can observe natively (App Service, its Plan, Application Insights) — not the app's own `sre_events` store, which lives in blob storage and isn't something an `azurerm_monitor_*` alert can query. That's what the in-app dashboard is for.

---

## 5. Runbooks

### Backend error rate is elevated / `backend_http_5xx` fired
1. Check `/ops` → Application Health for the error-rate trend and which time bucket it started in.
2. Check `/ops` → Diagnostics, filter to `failure`, look at `error_message` and `details.path` to find the specific failing endpoint.
3. Cross-reference `/ops` → AI Services — a downstream Azure OpenAI/Document Intelligence outage often surfaces as backend 5xx, not just AI-service failures, if a route doesn't handle `AzureServiceError` gracefully.
4. Once deployed: check Application Insights **Failures** blade for the exception stack trace and correlate by `request_id` (see `X-Request-ID` response header, set by `RequestContextMiddleware`).

### AI service shows "Circuit breaker: Open" / `azure_openai_chat` critical
1. This means the app already detected 3+ consecutive Azure OpenAI failures and is deliberately skipping calls for `AZURE_OPENAI_BREAKER_COOLDOWN_SECONDS` (default 60s), falling back to deterministic logic — **this is graceful degradation working as designed, not new breakage**, but it means AI-powered features (parsing quality, copilot) are temporarily running in reduced/deterministic mode.
2. Check `AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_API_KEY` are valid and the deployment exists — the most common cause is an expired key or a deployment name mismatch (see `KNOWN-ISSUES.md` in the backend for known deployment-name gotchas).
3. Check Azure OpenAI resource quota/throttling (429s) in the Azure Portal.
4. The breaker self-recovers — one probe request goes through after the cooldown. No manual reset needed; just confirm `/api/ops/ai-services` shows `breaker_open: false` again after the cooldown window.

### Copilot fallback rate is elevated
1. Check `/ops` → Diagnostics, filter to `fallback`, `service=copilot_agent` — the `error_message` on each entry is the actual exception from the agent path (tool-selection JSON parse failure, `CopilotToolError`, or an `AzureServiceError` from the breaker).
2. If it correlates with `azure_openai_chat` failures/breaker-open in the same window, it's the same root cause as above — the agent's LLM calls share the same breaker.
3. If Azure OpenAI itself is healthy but fallback rate is still high, check for a recent change to the tool-selection or synthesis prompts (`copilot_agent.py`'s `TOOL_SELECT_SYSTEM`/`SYNTHESIS_SYSTEM`) — a prompt that stops returning valid JSON will fail every turn without ever showing up as an "Azure" failure.

### Document Intelligence failure/degraded
1. Check `/ops` → AI Services → Document Intelligence card for failure count and recent latency.
2. Common cause: a resume file type/size the S0 tier rejects, or an expired key. Check `/ops` → Diagnostics filtered to `service=document_intelligence, status=failure` for the specific `error_message`.
3. Confirm fallback worked: uploads should still complete via `resume_parser.py`'s local `pypdf`/regex fallback (candidate gets created with degraded field extraction) rather than failing the whole upload — see the "why parsing came back empty" note in `docs/ai-architecture.md` if structured fields look sparse even without an error.

### App Service CPU high / `backend_cpu_high` fired
1. Check `/ops` → Application Health for a request-volume spike that correlates.
2. The B1 App Service Plan tier has no autoscale headroom — if this is sustained (not a one-off batch upload), scale up via `var.app_service_sku` in Terraform rather than letting it recur.

### Deployment just happened and something looks wrong
1. Check the Azure DevOps pipeline run (`azure-pipelines.yml`) completed both `DeployBackend` and `DeployFrontend` jobs successfully.
2. Compare `/ops` → Application Health's error-rate trend against the deploy timestamp — a step-change right at deploy time strongly implicates the release over an external dependency issue.
3. Full deploy-status visibility inside the dashboard itself is a Phase 2 item — see Section 7.

---

## 6. Configuration reference

| Setting | Where | Purpose |
|---|---|---|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | `backend/.env` / App Service app setting (Key Vault-backed) | Enables OpenTelemetry export to Azure Monitor. Unset = disabled, no-op — the in-app dashboard works either way. |
| `var.alert_notification_email` | `infra/terraform/*.tfvars` | Email the alert action group notifies. Empty by default. |
| (none needed for the in-app dashboard itself) | — | `/api/ops/*` and `/ops` work with zero additional configuration beyond a running backend. |

---

## 7. Deferred (Phase 2+) — and why

- **Deep infrastructure monitoring** (Blob Storage, Key Vault, Document Intelligence *resource-level* metrics via the Azure Monitor Query SDK) — App Insights auto-instrumentation already covers backend request/dependency telemetry; resource-level metrics need a live deployed environment to mean anything and add a second SDK/query surface.
- **Richer alert thresholds / more alert rules** — today's four are a deliberately basic, actionable starting set; expanding them (e.g. AI-service-specific alerts sourced from `sre_events` instead of Azure Monitor) is real future work.
- **Azure Pipelines CI/CD visibility inside the dashboard** — needs a user-supplied Azure DevOps PAT/org/project/pipeline-id; nothing like this exists in the repo today.
- **Centralized searchable log viewer backed by real Log Analytics KQL** — the Diagnostics tab is the local-mode substitute; full KQL search needs live Azure telemetry.
- **Performance baselines / trend-over-time** — needs the `sre_events` stream running for a meaningful period before "normal" can be defined.
- **Azure AI Search call tracking** — no live query call site exists in the app yet.
