"""One-off cleanup: clear stale ResumeUpload rows left over from
purge_dummy_candidates.py.

Upload dedupe checks `ResumeUpload.candidate_id is not None` by filename
(see app/routes/resumes.py::upload_resumes) — it never looks at whether that
candidate still exists. After the candidate purge, every one of those rows
points at a deleted Candidate, so any resume with a previously-seen filename
gets wrongly flagged "duplicate" and never gets processed.

Deletes ResumeUpload rows whose candidate_id no longer resolves to a real
Candidate.

Usage:
    python3 scripts/purge_orphaned_resume_uploads.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.storage.store import store  # noqa: E402


def main() -> None:
    uploads = store.resume_uploads.list_all()
    print(f"Found {len(uploads)} resume_upload rows total")

    orphaned = [
        u for u in uploads if u.candidate_id is not None and store.candidates.get(u.candidate_id) is None
    ]
    print(f"Found {len(orphaned)} orphaned (candidate no longer exists)")

    for u in orphaned:
        store.resume_uploads.delete(u.id)

    remaining = store.resume_uploads.list_all()
    print(f"Done. Remaining resume_upload rows: {len(remaining)}")


if __name__ == "__main__":
    main()
