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
| 📋 **[product-requirements-and-features.md](product-requirements-and-features.md)** | Product Managers, Engineering Leads | Full PM specification detailing all MVP, Level 1, and Level 2 product features, user personas, API contracts, and user flows. |
| 🧠 **[ai-architecture.md](ai-architecture.md)** | AI/ML Engineers, Backend Developers | Deep dive into AI provider seams, structured output schemas, 3-signal scoring engine, Copilot agent tools, and scheduling NL processing. |
| 🏗️ **[architecture.md](architecture.md)** | System Architects, Backend Engineers | High-level system architecture, service boundaries, `JsonBlobStore` repository pattern, and REST API directory. |
| 🛠️ **[development.md](development.md)** | All Developers & AI Assistants | Quick-start guide for local development, running mock vs live Azure modes, running backend test suites, and frontend Vite builds. |
| 🚀 **[deployment.md](deployment.md)** | DevOps & Site Reliability Engineers | Production deployment procedures, Azure infrastructure, environment variable matrix, and monitoring. |


---

## Sprint Alignment & Feature Summary

ResumeIQ is currently aligned on the **`phase-2`** sprint branch, utilizing an **asynchronous JSON Blob Storage architecture (`JsonBlobStore` / `Store` facade)**:

- **Storage Engine**: `JsonBlobStore` backing all domain entities (`candidates`, `job_postings`, `evaluations`, `audits`, `handoffs`, `interviews`, `screening_sessions`, `ats_benchmarks`).
- **AI Integrations**: Azure AI Document Intelligence for OCR parsing, Azure OpenAI for structured extraction and match explanations, Microsoft Teams for live meeting link generation, and Outlook for calendar invites.
- **Verification Status**: 36/36 backend tests passing (`pytest`); 100% clean production build (`npm run build`).
