# Demo script — Recruiter workflow (10 minutes)

**Goal:** One hiring decision on Backend Engineer, not a tour of buttons.

**Setup (T-15 min):** `./scripts/verify-demo.sh`. Browser at [http://localhost:8080](http://localhost:8080). Have `demo/jd/backend-engineer.txt` and `demo/resumes/` ready. Copilot closed until the script says to open it.

**Backup if anything fails:** skip the live upload, stay on Dashboard → Backend Engineer → Candidates. Alice / Priya / Bob are already in the UI pool. Copilot still answers from the seeded API (or local agent).

---

### 0:00 Workspace (45s)

Open **Dashboard**.

Say: “This is the recruiter’s workspace — active jobs, pipeline size, screening progress, internal vs external. We are filling Backend Engineer.”

Point at the Backend Engineer card (pipeline bar, 20 internal / 48 external is the broader pool; our three named people are pinned on this job). Click **Open pipeline**.

### 0:45 Job pipeline (45s)

Breadcrumb Workspace → Backend Engineer.

Say: “Pipeline stages and origin. We will add a JD, parse three resumes, rank with evidence, compare, ask Copilot, then decide.”

Click **Job description**.

### 1:30 JD analysis (60s)

Paste from `demo/jd/backend-engineer.txt` into the chat, or use: **“What skills are needed for a backend engineer?”**

Wait for Skills / Experience / Education / Certifications to fill. Point at **MUST** Python, FastAPI, SQL, Azure, Docker.

Do not wander into plumber/nurse examples.

### 2:30 Resume parse (90s) — skip if verify already seeded and time is tight

**Resume Upload** (from the job actions or sidebar). Drop the three `.txt` files in `demo/resumes/`. Watch OCR → AI parsing complete.

Say: “Mock or live Document Intelligence plus extraction. These three files are the only ones we will judge.”

If parse clones names or stalls: **backup** — files were pre-seeded; go to ranking.

### 4:00 Ranking + evidence (90s)

**Candidate Ranking** with the Backend Engineer chip on. Filter **All**.

Alice Johnson should be near the top of this job’s pipeline (score ~90s). Expand her row.

Point at: skills vs gaps, evidence chips (`Python — Owned FastAPI payments API`), Internal/External badges (Alice external, Priya internal).

Toggle **Add to comparison** on Alice and Bob.

### 5:30 Comparison (45s)

Open **Compare** (sticky bar or sidebar). Side-by-side scores. Alice wins on skills/experience; Bob has no Azure/Python.

### 6:15 Copilot (90s)

Header sparkle. Suggested asks (use these exact lines):

1. **Who meets every must-have skill?**
2. **Compare Alice Johnson and Bob Martinez**
3. **What's the biggest skill gap right now?**

Expect tool chips (Must-haves / Compare / Skill gaps) and resume evidence citations. If CWYD is down, answers still come from the local agent.

### 7:45 Decision (45s)

Back to Alice: **Approve** → confirm. Toast: email sent or mock-logged. Optional: expand Priya → **Background check** (fraud page) for 15s, then return.

Close: “Hire Alice, interview Priya internally, reject Bob. Same workflow for every req.”

---

## Timed backup path (5 minutes)

If Azure, upload, or Copilot misbehave:

1. Dashboard → Backend Engineer → Rank  
2. Expand Alice evidence  
3. Compare Alice vs Bob  
4. Copilot: “Who meets every must-have skill?”  
5. Approve Alice  

Do not open Fraud Detection from the sidebar first. Do not re-tune weights live. Do not upload random PDFs.

## Day-of checks

| Check | Command / place |
|-------|-----------------|
| API + Alice #1 + Copilot | `./scripts/verify-demo.sh` |
| UI | http://localhost:8080 |
| Isolated API | `./scripts/demo-up.sh` |
| Live Azure | Only if `USE_MOCK_AZURE=false` and keys were tested today |
| Email | Leave SMTP unset unless you want a real inbox |
