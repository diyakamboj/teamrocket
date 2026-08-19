# ResumeIQ Frontend — Architectural Overview & Developer Guide

This document provides a comprehensive overview of the **ResumeIQ Frontend** application. It is designed to help engineers, product managers, and new team members quickly understand the UI structure, component patterns, state management, and backend API integration.

---

## 1. Core Technology Stack

- **Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Routing**: [TanStack Router](https://tanstack.com/router) (file-based routing under `src/routes/`), client-rendered only — no TanStack Start/SSR; every data fetch goes client-side through `src/lib/api.ts` to the FastAPI backend
- **Build Tool**: [Vite](https://vitejs.dev/), plain static build (`dist/`)
- **Styling**: [TailwindCSS v4](https://tailwindcss.com/) with a clean, light enterprise SaaS theme (`bg-white`, `border-slate-200`, crisp typography, and high-contrast badges)
- **UI Components**: [Radix UI](https://www.radix-ui.com/) primitives & [Shadcn UI](https://ui.shadcn.com/) design system
- **Icons**: [Lucide React](https://lucide.dev/)
- **Notifications**: [Sonner](https://sonner.emilkowal.ski/) toast notifications

---

## 2. Directory & Application Structure

```text
frontend/
├── src/
│   ├── components/         # Reusable UI components & modals
│   │   ├── app-shell.tsx                # Main App Navigation & Top Header
│   │   ├── candidate-detail-modal.tsx   # Comprehensive Candidate Drawer/Modal
│   │   ├── create-job-modal.tsx         # Crisp White Job Creation Wizard
│   │   ├── copilot-sidebar.tsx          # Floating Recruiter Copilot AI Chat
│   │   ├── candidate-enrichment-card.tsx# External GitHub/LinkedIn enrichment
│   │   ├── candidate-readiness-card.tsx # Assessment & Readiness scores
│   │   ├── interview-card.tsx           # Automated Interview Scheduling
│   │   ├── screening.tsx                # AI Phone Screening sessions
│   │   ├── score-ring.tsx               # Visual score rings & mini bar charts
│   │   └── candidate-badges.tsx         # Skill evidence badges
│   ├── routes/             # File-based TanStack Router Pages
│   │   ├── index.tsx                    # Executive Overview Dashboard (/)
│   │   ├── jobs.$jobId.tsx              # Central Unified Job Workspace
│   │   ├── candidates.tsx               # Global Candidate Ranking Table
│   │   ├── internal-hiring.tsx          # Internal Mobility Talent Marketplace
│   │   ├── external-hiring.tsx          # External Sourcing Workspace
│   │   ├── actions.tsx                  # Recruiter Action & Review Center
│   │   ├── settings.tsx                 # Recruiter Settings & Company Docs
│   │   ├── upload.tsx                   # Bulk Resume OCR & AI Upload Page
│   │   ├── compare.tsx                  # Side-by-Side Candidate Comparison
│   │   ├── screening.tsx                # AI Screening Sessions Overview
│   │   ├── ats-benchmark.tsx            # Keyword vs Semantic ATS Benchmark
│   │   ├── fraud-detection.tsx          # Resume Consistency & Fraud Review
│   │   └── login.tsx                    # Recruiter Authentication Page
│   ├── lib/                # API client, state management & utils
│   │   ├── api.ts                       # Typed REST API Client for Backend
│   │   ├── app-state.ts                 # React Application State Context
│   │   ├── auth.ts                      # Recruiter Auth & Session state
│   │   ├── settings.ts                  # Workspace preferences & Company Docs
│   │   └── mock-data.ts                 # Fallback datasets for offline mode
│   └── styles.css          # Global CSS tokens & Tailwind import
```

---

## 3. Recruiter Workflows & Key Pages

### 1. Executive Dashboard (`/`)
- Displays high-level hiring metrics (Active Openings, Candidates Evaluated, Interviews Scheduled, Pending Actions).
- Provides direct workspace action links to **Internal Mobility** (`/internal-hiring`) and **External Sourcing** (`/external-hiring`).
- Includes a primary **"+ Create New Job"** CTA triggering the job wizard modal.

### 2. Central Unified Job Workspace (`/jobs/$jobId`)
- Serves as the recruiter's single workspace for a specific job posting.
- Features multi-tab navigation:
  1. **Candidates Table**: Interactive ranking table with weighted match sliders, score breakdowns, and blind review mode.
  2. **Pipeline View**: Visual stage tracker (Applied → Screened → Interviewing → Offered).
  3. **Bulk Resume Upload**: Drag-and-drop area connected directly to `POST /api/resumes/upload` with live OCR parsing tracker.
  4. **Hiring Insights**: Market talent distribution analytics.

### 3. Candidate Detail Drawer (`CandidateDetailModal`)
- Modal that opens when clicking any candidate row.
- Includes full tabs:
  - **Overview**: Overall match score, strength highlights, skill badges.
  - **Parsed Resume**: Raw text, extracted work history, education, certifications.
  - **Enrichment**: Live GitHub repository analysis, public contributions, external link verification.
  - **Readiness**: Assessment scores and skill gap probes.
  - **Interview Scheduling**: 1-click MS Teams meeting generation and Outlook calendar invite link creation.

### 4. Recruiter Copilot Sidebar (`copilot-sidebar.tsx`)
- Persistent AI assistant accessible from the right sidebar.
- Allows recruiters to ask natural language queries (*"Compare top 3 Python candidates"*, *"Who is ready for a Lead role?"*, *"Schedule an interview with Alice"*).
- Communicates directly with backend FastAPI Copilot endpoints (`/api/agent/ask`).

---

## 4. API Integration & Local Development

### API Client (`frontend/src/lib/api.ts`)
- All network requests communicate with the FastAPI backend running on port `8000`.
- Environment variable `VITE_API_BASE_URL` specifies the backend host (`http://localhost:8000` by default).

### Running the Frontend
```bash
cd frontend
npm install
npm run dev
# App launches at http://localhost:8080
```
