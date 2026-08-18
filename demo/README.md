# ResumeIQ product demo

Controlled Backend Engineer shortlist used for the live walkthrough.
Do not edit these files in the hour before presenting.

## Dataset

| Person | Role in the story | Stack | Origin | Expected outcome |
|--------|-------------------|-------|--------|------------------|
| **Alice Johnson** | Strong hire | Python, FastAPI, SQL, Azure, Docker, K8s | External | Rank #1, interview / approve |
| **Priya Sharma** | Strong internal | Python, Azure, K8s, Terraform | Internal | Rank #2, screen / interview |
| **Bob Martinez** | Clear reject | Java, SQL, Excel | External | Rank last, reject |

JD: `demo/jd/backend-engineer.txt`  
Resumes: `demo/resumes/*.txt` (plain text so mock OCR is deterministic)

## Freeze the environment

1. Stop making UI/API feature changes.
2. Use mock Azure unless live keys were verified the same day:

```bash
export USE_MOCK_AZURE=true
```

3. Seed data (pick one):

```bash
# A) Isolated SQLite + API without --reload (preferred)
./scripts/demo-up.sh

# B) Load the corpus into an API that is already running
python backend/scripts/seed_demo.py --api http://localhost:8000
```

4. Frontend: http://localhost:8080 (existing `npm run dev` is fine).
5. Verify:

```bash
./scripts/verify-demo.sh
```

`verify-demo.sh` checks API health, Alice as rank #1, and a Copilot ask. CWYD on :8001 is optional; the local agent is the backup.

## Accounts

| Use | Value |
|-----|--------|
| Recruiter | `recruiter@example.com` (`VITE_RECRUITER_EMAIL` / `X-Recruiter-Email`) |
| Approve/reject email | Mock SMTP unless `SMTP_*` is set — toast will say logged (mock) |

No extra logins. Blind review is a toggle on Candidates.

## If Azure or Copilot is down

Keep `USE_MOCK_AZURE=true`. Resume parse, JD extract, ranking, and Copilot still run locally.
If CWYD (:8001) is down, Copilot `source` is `local`.
If ranking API is empty, the UI still shows Alice / Priya / Bob on **Backend Engineer**.
Script: `demo/DEMO_SCRIPT.md`.
