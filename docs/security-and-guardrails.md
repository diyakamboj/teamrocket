# ResumeIQ Security, Safety & AI Guardrails Specification

This document details the security architecture, AI safety guardrails, PII redaction controls, model access rules, and data privacy mechanisms implemented across the **ResumeIQ** platform (`frontend`, `backend`, and `copilot` services).

---

## 1. Overview & Documentation Map

ResumeIQ utilizes multi-layered security controls to protect candidate data, suppress LLM hallucinations, enforce model access policies, and prevent unauthorized actions.

### Documentation Taxonomy: AI Context vs. System Specs
- **Repository Documentation (`docs/`)**: Human-readable and architectural specifications detailing system design, API contracts, deployment rules, and security.
- **AI Coding Context (`docs/ai-context.md`, `.github/copilot-instructions.md`, `AGENTS.md`)**: Specialized instruction files loaded by AI coding assistants (Antigravity, GitHub Copilot) to enforce codebase patterns, facade store access rules, and non-destructive refactoring.
- **Runtime Guardrails (`backend/app/services/`)**: Enforced code boundaries, Pydantic schemas, PII redaction filters, and prompt safety instructions executed during live user interactions.

---

## 2. AI Safety & Hallucination Guardrails

### A. Strict Grounding & Anti-Hallucination Prompts
All LLM parsing and evaluation operations use strict system prompts designed to prevent factual invention, embellishment, or ungrounded assumptions.

```text
RESUME_SYSTEM_PROMPT:
"You are a resume parsing engine for a recruiting platform.
Extract structured data from the resume text exactly as written — never invent, infer or embellish facts.
Rules:
- Use "" or omit a field when the resume does not state it. Do not guess.
- skills must be concrete technologies, tools, languages, methodologies or domain skills.
- Return JSON only."
```

### B. Low-Temperature Deterministic Execution
- **Structured Output Parsing**: Executed at `temperature=0` to ensure schema compliance and deterministic field extraction.
- **Candidate Scoring & Evaluation**: Executed at low temperature (`0.2`–`0.3`) to guarantee consistent, evidence-backed scoring.

### C. Azure AI Content Safety Integration
- The Copilot service (`copilot/`) integrates with **Azure AI Content Safety** (`azure-ai-contentsafety`) to scan incoming prompt messages for harm, prompt injection, and inappropriate content before passing queries to LLM orchestrators.

---

## 3. Blind Review & PII Redaction (Cognitive Bias Reduction)

To eliminate hiring bias during candidate evaluation, ResumeIQ features an automated **Blind Review Mode**:

1. **PII Masking**: Candidate names, email addresses, phone numbers, and portfolio URLs are dynamically redacted in candidate ranking responses (`GET /api/candidates/rank?blind_mode=true`).
2. **System Prompt Redaction**: When `blind_mode=true` is passed to the Recruiter Copilot agent, candidate names are replaced with anonymous identifiers (e.g., `Candidate #1`, `Candidate #2`), and explicit prompt instructions forbid the model from revealing identifying information.
3. **Audit Trail**: Toggling blind mode is recorded in audit logs to track compliance with fair-hiring policies.

---

## 4. Model Registry & Server-Enforced Access Controls (RBAC)

ResumeIQ implements server-enforced model access control in `backend/app/services/model_registry.py` and `backend/app/routes/agent.py`:

```json
COPILOT_MODEL_REGISTRY = [
  {"id": "gpt-4o", "label": "GPT-4o", "description": "Balanced default.", "is_default": true},
  {"id": "gpt-4o-mini", "label": "GPT-4o mini", "description": "Faster, lower-cost.", "is_default": false},
  {"id": "gpt-4.1", "label": "GPT-4.1", "description": "Extended reasoning.", "is_default": false}
]
```

- **Allowlist Verification**: Inbound requests specifying a `model_id` are validated against `COPILOT_MODEL_ALLOWLIST`.
- **Unauthorized Request Rejection**: Requests specifying unapproved or disallowed model deployments return an immediate HTTP `403 Forbidden` / HTTP `422 Validation Error`.
- **Fallback Protection**: Unspecified model IDs automatically default to the server-configured default (`gpt-4o`).

---

## 5. Secrets Management & Data Privacy

- **Zero Hardcoded Credentials**: No API keys, passwords, or client secrets are committed to the git repository.
- **Environment Isolation**: Sensitivity files (`.env`, `.env.local`, `.venv`, `.tfstate`, `*.pem`) are explicitly excluded via root and service-level `.gitignore` files.
- **OIDC & Azure Managed Identity**: Deployment workflows in GitHub Actions use OpenID Connect (OIDC) federated credentials (`environment: dev`) and Azure Managed Identity, eliminating long-lived storage connection strings.
- **Local Mock Mode**: The system defaults to `USE_MOCK_AZURE=true` for local development, storing documents safely in local directory storage without sending data to external cloud services.

---

## 6. Input Validation & API Defense

- **File Type & Extension Whitelisting**: Resume uploads strictly validate filenames against allowed extensions (`.pdf`, `.docx`, `.txt`, `.png`, `.jpg`) using `is_allowed_resume_filename()`.
- **Payload Size Limits**: Strict content-length boundaries are enforced:
  - Resume uploads: `MAX_RESUME_SIZE_BYTES = 15 * 1024 * 1024` (15 MB).
  - Copilot attachments: `COPILOT_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024` (15 MB).
- **Pydantic Type Validation**: Inbound JSON payloads across all REST routes undergo strict schema validation via Pydantic v2 models.
- **CORS Protection**: Access is restricted strictly to authorized recruiter origins (`CORS_ORIGINS`).
- **Audit Logging**: Every administrative action, candidate decision, job creation, and handoff event is written to `store.audit_logs` with recruiter email timestamps.
