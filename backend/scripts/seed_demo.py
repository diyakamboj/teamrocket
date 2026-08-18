#!/usr/bin/env python3
"""Seed a controlled Backend Engineer pool for the product demonstration.

Default: write to the isolated SQLite file `backend/demo_resume_assistant.db`.
Pass --api http://localhost:8000 to load the same resumes into a running server
via upload (uses mock/live parsing).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
DEMO = ROOT / "demo"
JOB_ID = uuid.UUID("aaaaaaaa-1111-4111-8111-000000000001")
CANDIDATE_IDS = {
    "alice.johnson@example.com": uuid.UUID("bbbbbbbb-1111-4111-8111-000000000001"),
    "priya.sharma@example.com": uuid.UUID("bbbbbbbb-1111-4111-8111-000000000002"),
    "bob.martinez@example.com": uuid.UUID("bbbbbbbb-1111-4111-8111-000000000003"),
}

JD_PATH = DEMO / "jd" / "backend-engineer.txt"
RESUME_DIR = DEMO / "resumes"


def _api_seed(base: str) -> None:
    import urllib.error
    import urllib.request

    jd = JD_PATH.read_text(encoding="utf-8")
    job_body = json.dumps(
        {
            "title": "Backend Engineer",
            "description": jd,
            "required_skills": ["Python", "FastAPI", "SQL", "Azure", "Docker"],
            "required_experience_years": 3,
            "education_requirements": "Bachelor's in Computer Science or equivalent",
            "nice_to_have_skills": ["Kubernetes", "Terraform"],
            "created_by": "recruiter@example.com",
        }
    ).encode()

    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/jobs",
        data=job_body,
        headers={
            "Content-Type": "application/json",
            "X-Recruiter-Email": "recruiter@example.com",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        job = json.loads(resp.read().decode())
    print(f"Created job {job['id']} ({job['title']})")

    analyze = urllib.request.Request(
        f"{base.rstrip('/')}/api/jobs/{job['id']}/analyze",
        data=b"",
        headers={"X-Recruiter-Email": "recruiter@example.com"},
        method="POST",
    )
    with urllib.request.urlopen(analyze, timeout=60) as resp:
        analyzed = json.loads(resp.read().decode())
    print(f"Analyzed JD → skills {analyzed.get('required_skills')}")

    boundary = "----ResumeIQDemo"
    parts: list[bytes] = []
    for path in sorted(RESUME_DIR.glob("*.txt")):
        payload = path.read_bytes()
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="files"; filename="{path.name}"\r\n'
                "Content-Type: text/plain\r\n\r\n"
            ).encode()
            + payload
            + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    upload = urllib.request.Request(
        f"{base.rstrip('/')}/api/resumes/upload",
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-Recruiter-Email": "recruiter@example.com",
        },
        method="POST",
    )
    with urllib.request.urlopen(upload, timeout=60) as resp:
        uploaded = json.loads(resp.read().decode())

    ids = [item["resume_id"] for item in uploaded.get("files") or []]
    print(f"Uploaded {len(ids)} resumes, waiting for parse…")
    for resume_id in ids:
        for _ in range(40):
            status_req = urllib.request.Request(
                f"{base.rstrip('/')}/api/resumes/{resume_id}",
                headers={"X-Recruiter-Email": "recruiter@example.com"},
            )
            with urllib.request.urlopen(status_req, timeout=30) as resp:
                row = json.loads(resp.read().decode())
            if row.get("status") in {"complete", "failed"}:
                print(f"  {row.get('filename')}: {row.get('status')}")
                break
            time.sleep(0.4)

    rank = urllib.request.Request(
        f"{base.rstrip('/')}/api/candidates/rank?job_id={job['id']}",
        headers={"X-Recruiter-Email": "recruiter@example.com"},
    )
    with urllib.request.urlopen(rank, timeout=60) as resp:
        ranked = json.loads(resp.read().decode())
    names = [row.get("name") or row.get("candidate_name") for row in ranked[:5]]
    print(f"Top ranked: {names}")
    (DEMO / ".last-job-id").write_text(job["id"], encoding="utf-8")


def _db_seed() -> None:
    import os

    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    from app.database import SessionLocal, init_db
    from app.models.candidate import Candidate
    from app.models.job_posting import JobPosting
    from app.services.candidate_matcher import candidate_matcher

    init_db()
    db = SessionLocal()
    jd = JD_PATH.read_text(encoding="utf-8")

    job = db.get(JobPosting, JOB_ID)
    if job is None:
        job = JobPosting(id=JOB_ID, title="Backend Engineer", description=jd)
        db.add(job)
    job.title = "Backend Engineer"
    job.description = jd
    job.required_skills = ["Python", "FastAPI", "SQL", "Azure", "Docker"]
    job.required_experience_years = 3
    job.education_requirements = "Bachelor's in Computer Science or equivalent"
    job.nice_to_have_skills = ["Kubernetes", "Terraform"]
    job.created_by = "recruiter@example.com"

    profiles = [
        {
            "email": "alice.johnson@example.com",
            "name": "Alice Johnson",
            "phone": "+1-555-0101",
            "file": "alice-johnson.txt",
            "skills": ["Python", "FastAPI", "SQL", "Azure", "Docker", "Kubernetes"],
            "experience": [
                {
                    "company": "Northwind Cloud",
                    "title": "Senior Backend Engineer",
                    "years": 6,
                    "description": "Owned FastAPI payments API on Azure SQL and AKS",
                }
            ],
            "education": [{"school": "TU Berlin", "degree": "BSc", "field": "Computer Science"}],
            "certifications": ["AZ-204", "AZ-900"],
            "projects": [
                {
                    "name": "Payments API",
                    "description": "FastAPI service, 2M req/day",
                    "technologies": ["Python", "FastAPI", "Azure"],
                }
            ],
        },
        {
            "email": "priya.sharma@example.com",
            "name": "Priya Sharma",
            "phone": "+1-555-0102",
            "file": "priya-sharma.txt",
            "skills": ["Python", "Azure", "Kubernetes", "Terraform", "Docker", "SQL"],
            "experience": [
                {
                    "company": "ResumeIQ",
                    "title": "Cloud Platform Engineer",
                    "years": 5,
                    "description": "Internal AKS landing zone, Terraform, Python tooling",
                }
            ],
            "education": [{"school": "State U", "degree": "MSc", "field": "Software Engineering"}],
            "certifications": ["AZ-400", "CKA"],
            "projects": [
                {
                    "name": "Shared AKS landing zone",
                    "description": "Internal platform",
                    "technologies": ["Azure", "Kubernetes", "Terraform"],
                }
            ],
        },
        {
            "email": "bob.martinez@example.com",
            "name": "Bob Martinez",
            "phone": "+1-555-0103",
            "file": "bob-martinez.txt",
            "skills": ["Java", "SQL", "Excel"],
            "experience": [
                {
                    "company": "Globex",
                    "title": "Reporting Analyst",
                    "years": 2,
                    "description": "Java/SQL revenue dashboards",
                }
            ],
            "education": [{"school": "City College", "degree": "BA", "field": "Business"}],
            "certifications": [],
            "projects": [{"name": "Revenue dashboards", "description": "SQL reporting"}],
        },
    ]

    for profile in profiles:
        cid = CANDIDATE_IDS[profile["email"]]
        text = (RESUME_DIR / profile["file"]).read_text(encoding="utf-8")
        candidate = db.get(Candidate, cid) or db.query(Candidate).filter(
            Candidate.email == profile["email"]
        ).first()
        if candidate is None:
            candidate = Candidate(id=cid, name=profile["name"], email=profile["email"])
            db.add(candidate)
        candidate.name = profile["name"]
        candidate.email = profile["email"]
        candidate.phone = profile["phone"]
        candidate.resume_text = text
        candidate.skills = profile["skills"]
        candidate.experience = profile["experience"]
        candidate.education = profile["education"]
        candidate.certifications = profile["certifications"]
        candidate.projects = profile["projects"]

    db.commit()
    db.refresh(job)

    import asyncio

    ranked = asyncio.run(candidate_matcher.rank_candidates(db, job.id, persist=True))
    db.close()
    print(f"Seeded job {job.id}")
    print("Top ranked:")
    for row in ranked[:5]:
        print(f"  {row.get('rank')} {row.get('name')}  score={row.get('overall_score')}")
    (DEMO / ".last-job-id").write_text(str(job.id), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the ResumeIQ product demo dataset")
    parser.add_argument(
        "--api",
        metavar="URL",
        help="Upload resumes into a running API instead of writing SQLite directly",
    )
    args = parser.parse_args()
    if args.api:
        try:
            _api_seed(args.api)
        except Exception as exc:  # pragma: no cover - CLI surface
            raise SystemExit(f"API seed failed: {exc}") from exc
        return
    _db_seed()


if __name__ == "__main__":
    main()
