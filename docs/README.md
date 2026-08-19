# ResumeIQ Product & Architecture Documentation (`phase-2`)

Welcome to the central technical and product documentation for **ResumeIQ** — an AI-powered recruiter platform that streamlines candidate resume parsing, job requirement extraction, multi-signal candidate matching, interview handoffs, visual skill verification, and automated interview scheduling.

---

## Technical Stack & System Layout

```text
teamrocket/
├── frontend/     # Recruiter UI & Dashboard (TanStack Start / React / Vite) — port 8080
├── backend/      # Screening API, AI Copilot, Blob Storage & Scheduling (FastAPI) — port 8000
├── copilot/      # Optional RAG chatbot layer (CWYD / Azure AI Search) — port 8001
└── docs/         # System Architecture & Product Specifications
```

---

## Documentation Index

| Document | Focus & Target Audience | Description |
|---|---|---|
| 🤖 **[ai-context.md](ai-context.md)** | **AI Coding Assistants** (Antigravity, Claude, Copilot) | Primary repository map, store access patterns, service paths, API directory, and coding rules for AI agents. |
| 🔍 **[product-gap-analysis.md](product-gap-analysis.md)** | Product Managers, Engineering Leads | Comprehensive Gap Analysis evaluating implemented features against the intended unified recruiter experience. |
| 📈 **[project-progress.md](project-progress.md)** | Engineering Leads, Stakeholders | Master progress report detailing all frontend, backend, AI architecture, and verification metrics. |
| 📋 **[product-requirements-and-features.md](product-requirements-and-features.md)** | Product Managers, Engineering Leads | Full PM specification detailing all MVP, Level 1, and Level 2 product features, user personas, API contracts, and user flows. |
| 🧠 **[ai-architecture.md](ai-architecture.md)** | AI/ML Engineers, Backend Developers | Deep dive into AI provider seams, structured output schemas, 3-signal scoring engine, Copilot agent tools, and scheduling NL processing. |
| 🏗️ **[architecture.md](architecture.md)** | System Architects, Backend Engineers | High-level system architecture, service boundaries, `JsonBlobStore` repository pattern, and REST API directory. |
| 🎨 **[frontend-overview.md](frontend-overview.md)** | Frontend Developers, UI/UX Engineers | Deep dive into React 19, Vite, TanStack Router pages, Tailwind v4 styling, component hierarchy, and API wiring. |
| 🐍 **[backend-overview.md](backend-overview.md)** | Backend Engineers, AI/ML Developers | In-depth breakdown of FastAPI routes, `JsonBlobStore` facade repository pattern, 3-signal candidate matcher, resume OCR parser, and test suite. |
| 🔒 **[security-and-guardrails.md](security-and-guardrails.md)** | Security Engineers, AI Safety Leads, Developers | Comprehensive spec covering AI prompt safety, PII redaction (blind review), model RBAC allowlists, secret management, and input validation. |
| 🚀 **[deployment.md](deployment.md)** | DevOps & Site Reliability Engineers | Production deployment procedures, Azure infrastructure, environment variable matrix, and monitoring. |
| 📊 **[observability.md](observability.md)** | DevOps & Site Reliability Engineers, Developers | The `/ops` health dashboard: what's monitored and why, Azure Monitor alert rules, and runbooks for common failures. |





---

## Sprint Alignment & Feature Summary

ResumeIQ is currently aligned on the **`phase-2`** sprint branch, utilizing an **asynchronous JSON Blob Storage architecture (`JsonBlobStore` / `Store` facade)**:

- **Storage Engine**: `JsonBlobStore` backing all domain entities (`candidates`, `job_postings`, `evaluations`, `audits`, `handoffs`, `interviews`, `screening_sessions`, `ats_benchmarks`).
- **AI Integrations**: Azure AI Document Intelligence for OCR parsing, Azure OpenAI for structured extraction and match explanations, Microsoft Teams for live meeting link generation, and Outlook for calendar invites.
- **Verification Status**: 36/36 backend tests passing (`pytest`); 100% clean production build (`npm run build`).
