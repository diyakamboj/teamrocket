"""One-off import: load resume_screening_synthetic_dataset.xlsx into blob storage.

Creates a single JobPosting representing the dataset's implied "demo job"
(BI/Data Analyst requiring Python, SQL, Power BI; nice-to-have Excel,
Statistics, Data Visualization, Azure), imports all 200 rows as Candidate
records, then runs the app's own CandidateMatcher.rank_candidates() against
that job so every Evaluation/Evidence record is produced by the real
scoring pipeline — not copied from the spreadsheet's own (differently
scaled) precomputed score columns.

Not imported automatically by the app; run manually:
    python3 scripts/import_synthetic_dataset.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models.candidate import Candidate  # noqa: E402
from app.models.job_posting import JobPosting  # noqa: E402
from app.services.candidate_matcher import CandidateMatcher  # noqa: E402
from app.storage.store import store  # noqa: E402

DATASET_PATH = Path(__file__).resolve().parent.parent.parent / "resume_screening_synthetic_dataset.xlsx"

JOB_TITLE = "Business Intelligence / Data Analyst (Synthetic Demo)"
JOB_DESCRIPTION = (
    "Synthetic demo role imported from resume_screening_synthetic_dataset.xlsx. "
    "Looking for an analyst comfortable turning raw data into dashboards and "
    "decisions: querying and cleaning data, building reporting pipelines, and "
    "communicating findings to stakeholders."
)
REQUIRED_SKILLS = ["Python", "SQL", "Power BI"]
NICE_TO_HAVE_SKILLS = ["Excel", "Statistics", "Data Visualization", "Azure"]
RECRUITER_EMAIL = "recruiter@example.com"


def _split(value: object) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in str(value).split(";") if part.strip()]


def _row_to_candidate(row: dict[str, object]) -> Candidate:
    candidate_key = row["candidate_id"] or "unknown"
    email = row["email"] or f"{candidate_key}@synthetic.example.com"

    months = row["experience_months"] or 0
    try:
        years = round(float(months) / 12, 1)
    except (TypeError, ValueError):
        years = 0.0

    experience = [
        {
            "company": None,
            "title": row["current_title"],
            "duration": None,
            "years": years,
            "description": row["experience_summary"] or "",
        }
    ]

    return Candidate(
        name=row["name"] or candidate_key,
        email=email,
        phone=row["phone"],
        location=row["location"],
        title=row["current_title"],
        resume_text=row["resume_text"],
        skills=_split(row["skills"]),
        experience=experience,
        education=[row["education"]] if row["education"] else [],
        certifications=_split(row["certifications"]),
        projects=[row["projects"]] if row["projects"] else [],
        source="external",
    )


def load_rows() -> list[dict[str, object]]:
    wb = openpyxl.load_workbook(DATASET_PATH, read_only=True)
    ws = wb["Sheet1"]
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    return [dict(zip(header, r)) for r in rows[1:]]


async def main() -> None:
    rows = load_rows()
    print(f"Loaded {len(rows)} rows from {DATASET_PATH.name}")

    job = JobPosting(
        title=JOB_TITLE,
        description=JOB_DESCRIPTION,
        required_skills=REQUIRED_SKILLS,
        nice_to_have_skills=NICE_TO_HAVE_SKILLS,
        created_by=RECRUITER_EMAIL,
    )
    store.jobs.save(job)
    print(f"Created job {job.id} ({job.title!r})")

    saved = 0
    errors: list[tuple[str, str]] = []
    for row in rows:
        try:
            candidate = _row_to_candidate(row)
            store.candidates.save(candidate)
            saved += 1
        except Exception as exc:  # best-effort import of a demo dataset
            errors.append((str(row.get("candidate_id")), str(exc)))

    print(f"Imported {saved}/{len(rows)} candidates ({len(errors)} errors)")
    for candidate_id, err in errors[:10]:
        print(f"  - {candidate_id}: {err}")

    print("Scoring all candidates against the demo job (real scoring pipeline)...")
    matcher = CandidateMatcher()
    ranked = await matcher.rank_candidates(store, job.id, persist=True)
    print(f"Scored and persisted {len(ranked)} evaluations.")
    if ranked:
        top = ranked[0]
        print(f"Top candidate: {top['name']} — {top['overall_score']}")


if __name__ == "__main__":
    asyncio.run(main())
