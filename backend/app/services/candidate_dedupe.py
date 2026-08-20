"""Deciding whether a résumé is someone the recruiter already has.

Duplicates used to be caught on filename alone, which is both too strict and
far too loose: the same person re-exported as "resume (1).pdf" sailed
through as a brand-new profile, while two different people who each named
their file "resume.pdf" blocked each other.

Identity is matched in the order it becomes knowable:

  1. file bytes  — an identical file is the same résumé, known at upload
     before anything is parsed;
  2. email       — the strongest identity signal a résumé carries;
  3. name+phone  — the fallback for résumés with no parseable email, which
     would otherwise be assigned a fresh placeholder address on every
     upload and so could never match themselves.

Everything is scoped to one recruiter's pool: two recruiters may each hold
the same person, and neither should block or overwrite the other's copy.
"""

from __future__ import annotations

import hashlib
import re
from typing import Optional

from app.models.candidate import Candidate
from app.storage.store import Store


def content_digest(data: bytes) -> str:
    """Stable digest of the uploaded bytes."""
    return hashlib.sha256(data).hexdigest()


def _norm_name(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _norm_phone(value: Optional[str]) -> str:
    """Digits only, last 10 — formatting and country prefixes vary between
    two exports of the same résumé."""
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else digits


def _is_placeholder(email: Optional[str]) -> bool:
    """True for the synthetic address given to a résumé with no readable
    email. Two of these are never evidence of the same person."""
    return bool(email) and str(email).startswith("candidate.") and "@example.com" in str(email)


def digests_for_recruiter(store: Store, recruiter_email: Optional[str]) -> dict[str, str]:
    """Map of content digest -> candidate id for everything this recruiter has
    already uploaded successfully.

    Built once per request. This reads every upload record, which against real
    blob storage is a slow, network-bound scan — doing it per file inside the
    upload loop meant one full listing per résumé, and doing it on the event
    loop froze every other request while it ran.
    """
    found: dict[str, str] = {}
    for row in store.resume_uploads.query(
        lambda r: r.recruiter_email == recruiter_email and r.candidate_id is not None
    ):
        digest = getattr(row, "content_sha256", None)
        if digest:
            found.setdefault(digest, str(row.candidate_id))
    return found


def find_existing_candidate(
    store: Store,
    *,
    owner_email: Optional[str],
    email: Optional[str],
    name: Optional[str] = None,
    phone: Optional[str] = None,
) -> Optional[Candidate]:
    """The candidate in this recruiter's pool who is the same person."""
    pool = [
        c
        for c in store.candidates.list_all()
        if owner_email is None or c.owner_email == owner_email
    ]

    if email and not _is_placeholder(email):
        target = email.strip().lower()
        for candidate in pool:
            if (candidate.email or "").strip().lower() == target:
                return candidate

    # No usable email: a name alone is too weak to merge two people on, so
    # it must be corroborated by a matching phone number.
    wanted_name = _norm_name(name)
    wanted_phone = _norm_phone(phone)
    if wanted_name and wanted_phone:
        for candidate in pool:
            if (
                _norm_name(candidate.name) == wanted_name
                and _norm_phone(candidate.phone) == wanted_phone
            ):
                return candidate
    return None


def already_in_pool_message(candidate: Candidate) -> str:
    """What the recruiter is told when an upload is refused."""
    where = "your candidate pool"
    if candidate.source == "internal":
        where = "your employee list"
    return (
        f"{candidate.name} is already in {where}. "
        "Open their profile to add them to another role instead of re-uploading."
    )
