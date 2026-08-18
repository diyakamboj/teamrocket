"""Resume / profile internal-consistency review for candidates.

Zero overlap with `fraud_service.py`: that module verifies flat identity
fields (name/email/employer names) against *external* sources (OFAC
sanctions list, Clearbit company lookup). This module never touches those —
it looks for internal inconsistencies within a candidate's own resume text
(conflicting dates, overlapping positions, inconsistent titles, inflated
experience claims) and, where available, discrepancies against the
candidate's own enriched external profile data.

This is explicitly a *flagging* tool for human review, never a fraud
verdict — there is no "verified"/"fraud" status anywhere here, only
`requires_review: bool` derived from a simple, documented threshold.

Mock-mode gating follows the established convention in `resume_parser.py`
and `job_analyzer.py`: check `openai_service.mock` directly and, when mock,
return a hand-built heuristic result (real regex/date-math, not a canned
stub) rather than adding a branch to the shared `_mock_response` dispatcher.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Literal, Optional

from app.models.candidate import Candidate
from app.services.azure_services import openai_service
from app.utils.logger import get_logger

logger = get_logger(__name__)

Severity = Literal["low", "medium", "high"]

CONSISTENCY_SYSTEM_PROMPT = """You review a candidate's own resume text for INTERNAL consistency only.
Never conclude fraud or verify identity — only flag objective inconsistencies visible directly in the
provided text (and, if given, the candidate's own enriched external profile data). Categories (use
exactly these category values):
- missing_document: resume is missing an expected section (education, experience, skills)
- date_conflict: an employment/date range ends before it starts, or is dated in the future
- overlapping_positions: two or more claimed positions have overlapping date ranges
- title_inconsistency: the same employer is listed with conflicting job titles
- inflated_experience: a claimed total years-of-experience figure is not supported by the summed
  duration of the positions described in the text
- external_discrepancy: a skill from the candidate's enriched external profile is not reflected
  anywhere in the resume text
For each issue return an object: {"id": "<short-slug>", "category": "<one of the above>",
"label": "<one sentence, recruiter readable>", "severity": "low"|"medium"|"high",
"detail": "<optional supporting detail, or null>"}.
Return JSON with a single key "flags": a list of these objects (empty list if none found).
Do not use any category value outside the list above. Do not speculate beyond what the text states."""

# Section headers a well-formed resume is expected to have, and the severity
# assigned when each one is entirely absent from the resume text.
_SECTION_HEADERS: dict[str, Severity] = {
    "experience": "medium",
    "education": "low",
    "skills": "medium",
}

# "2018 - 2020", "2018-2020", "2018 to 2020", "2020 - present" (case-insensitive).
_YEAR_RANGE_RE = re.compile(
    r"\b(?P<start>(?:19|20)\d{2})\s*(?:-|–|to)\s*(?P<end>(?:19|20)\d{2}|present)\b",
    re.IGNORECASE,
)
# "5 years of experience", "10+ years experience" — deliberately requires the
# word "experience" nearby so incidental phrases like "built APIs for 4
# years" (no explicit experience claim) don't trigger a false positive.
_CLAIMED_YEARS_RE = re.compile(
    r"\b(?P<years>\d{1,2})\+?\s*years?\s+(?:of\s+)?experience\b", re.IGNORECASE
)
# Best-effort "<Title> at <Company>" line scan, used to spot the same
# employer listed with two different job titles.
_TITLE_LINE_RE = re.compile(
    r"^(?P<title>[A-Z][A-Za-z/&\-.' ]{2,48}?)\s+at\s+(?P<company>[A-Z][A-Za-z0-9&.,'\- ]{2,48})\s*$",
    re.MULTILINE,
)


@dataclass
class Flag:
    id: str
    category: str
    label: str
    severity: Severity
    detail: Optional[str] = None


@dataclass
class ConsistencyResult:
    candidate_id: str
    flags: list[Flag] = field(default_factory=list)
    flagged_count: int = 0
    requires_review: bool = False
    summary: str = ""
    engine: str = "heuristic"


def analyze_candidate(candidate: Candidate) -> ConsistencyResult:
    resume_text = candidate.resume_text or ""

    if not openai_service.mock and resume_text.strip():
        try:
            return _analyze_with_llm(candidate, resume_text)
        except Exception as exc:  # falls back to heuristic on any failure
            logger.warning(
                "Consistency LLM analysis failed for candidate %s, falling back to heuristic: %s",
                candidate.id,
                exc,
            )

    flags = _heuristic_flags(candidate, resume_text)
    return _finalize(candidate, flags, engine="heuristic")


def _analyze_with_llm(candidate: Candidate, resume_text: str) -> ConsistencyResult:
    prompt = f'Resume text:\n"""\n{resume_text[:20000]}\n"""'
    if candidate.enriched_profile:
        prompt += f"\n\nCandidate's own enriched external profile data: {candidate.enriched_profile}"

    result = openai_service.chat_json_or_empty(
        prompt, system=CONSISTENCY_SYSTEM_PROMPT, temperature=0
    )
    raw_flags = result.get("flags") or []

    flags: list[Flag] = []
    for item in raw_flags:
        if not isinstance(item, dict):
            continue
        category = str(item.get("category") or "").strip()
        label = str(item.get("label") or "").strip()
        severity = str(item.get("severity") or "").strip().lower()
        if not category or not label or severity not in ("low", "medium", "high"):
            continue
        flags.append(
            Flag(
                id=str(item.get("id") or f"{category}-{len(flags)}"),
                category=category,
                label=label,
                severity=severity,  # type: ignore[arg-type]
                detail=item.get("detail") or None,
            )
        )

    return _finalize(candidate, flags, engine="azure-openai")


def _heuristic_flags(candidate: Candidate, resume_text: str) -> list[Flag]:
    flags: list[Flag] = []
    lowered = resume_text.lower()

    # 1. Missing-section detection.
    for header, severity in _SECTION_HEADERS.items():
        if header not in lowered:
            flags.append(
                Flag(
                    id=f"missing-{header}",
                    category="missing_document",
                    label=f"Resume has no '{header}' section",
                    severity=severity,
                    detail=f"No heading or mention of '{header}' found anywhere in the resume text.",
                )
            )

    # 2. Year-range extraction -> date conflicts / future dates; collect the
    # valid ranges for overlap + inflated-experience checks below.
    ranges: list[tuple[int, int]] = []
    current_year = date.today().year
    for match in _YEAR_RANGE_RE.finditer(resume_text):
        start = int(match.group("start"))
        end_raw = match.group("end")
        end = current_year if end_raw.lower() == "present" else int(end_raw)

        if end < start:
            flags.append(
                Flag(
                    id=f"date-conflict-{match.start()}",
                    category="date_conflict",
                    label=f"Date range '{match.group(0)}' ends before it starts",
                    severity="high",
                    detail=match.group(0),
                )
            )
            continue

        if start > current_year or end > current_year:
            flags.append(
                Flag(
                    id=f"future-date-{match.start()}",
                    category="date_conflict",
                    label=f"Date range '{match.group(0)}' is dated in the future",
                    severity="medium",
                    detail=match.group(0),
                )
            )
            continue

        ranges.append((start, end))

    # 3. Overlap detection between valid extracted ranges.
    if _has_overlap(ranges):
        flags.append(
            Flag(
                id="overlapping-positions",
                category="overlapping_positions",
                label="Two or more claimed positions have overlapping date ranges",
                severity="medium",
                detail=None,
            )
        )

    # 4. Claimed "N years of experience" vs. summed merged-interval years.
    claimed_matches = list(_CLAIMED_YEARS_RE.finditer(resume_text))
    if claimed_matches:
        claimed_years = max(int(m.group("years")) for m in claimed_matches)
        summed_years = _merge_intervals(ranges)
        if claimed_years - summed_years >= 3:
            flags.append(
                Flag(
                    id="inflated-experience",
                    category="inflated_experience",
                    label=(
                        f"Claims {claimed_years} years of experience, but dated positions in "
                        f"the resume sum to only {summed_years} year(s)"
                    ),
                    severity="high",
                    detail=f"claimed={claimed_years}, summed={summed_years}",
                )
            )

    # 5. Same-employer/different-title line scan (best-effort).
    titles_by_company: dict[str, set[str]] = {}
    for match in _TITLE_LINE_RE.finditer(resume_text):
        title = match.group("title").strip()
        company = match.group("company").strip()
        titles_by_company.setdefault(company.lower(), set()).add(title)
    for company_key, titles in titles_by_company.items():
        if len(titles) > 1:
            flags.append(
                Flag(
                    id=f"title-inconsistency-{company_key}",
                    category="title_inconsistency",
                    label=f"Multiple, differing job titles listed for the same employer ('{company_key}')",
                    severity="medium",
                    detail=", ".join(sorted(titles)),
                )
            )

    # 6. Enriched external profile skills not reflected anywhere in the resume text.
    enriched = candidate.enriched_profile or {}
    inferred_skills = enriched.get("inferred_skills") or []
    missing = [s for s in inferred_skills if isinstance(s, str) and s.lower() not in lowered]
    if missing:
        flags.append(
            Flag(
                id="external-discrepancy",
                category="external_discrepancy",
                label="Enriched external profile lists skills not found anywhere in the resume text",
                severity="low",
                detail=", ".join(missing),
            )
        )

    return flags


def _has_overlap(ranges: list[tuple[int, int]]) -> bool:
    ordered = sorted(ranges)
    for i in range(1, len(ordered)):
        if ordered[i][0] < ordered[i - 1][1]:
            return True
    return False


def _merge_intervals(ranges: list[tuple[int, int]]) -> int:
    if not ranges:
        return 0
    ordered = sorted(ranges)
    merged: list[list[int]] = [list(ordered[0])]
    for start, end in ordered[1:]:
        last = merged[-1]
        if start <= last[1]:
            last[1] = max(last[1], end)
        else:
            merged.append([start, end])
    return sum(end - start for start, end in merged)


def _requires_review(flags: list[Flag]) -> bool:
    high = sum(1 for f in flags if f.severity == "high")
    medium = sum(1 for f in flags if f.severity == "medium")
    return high >= 1 or medium >= 2


def _finalize(candidate: Candidate, flags: list[Flag], *, engine: str) -> ConsistencyResult:
    requires_review = _requires_review(flags)
    if not flags:
        summary = "No internal consistency issues detected in the resume text."
    elif requires_review:
        summary = (
            f"{len(flags)} consistency flag(s) found, including at least one significant "
            "issue — recruiter review recommended."
        )
    else:
        summary = f"{len(flags)} minor consistency flag(s) found; no urgent review required."

    return ConsistencyResult(
        candidate_id=str(candidate.id),
        flags=flags,
        flagged_count=len(flags),
        requires_review=requires_review,
        summary=summary,
        engine=engine,
    )
