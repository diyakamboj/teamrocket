"""Standardized candidate status flags and evidence-backed skill badges.

Badges are derived deterministically from data the screening pipeline has
already produced (match scores, matched skills, evidence snippets, parsed
profile fields) — no extra model calls, so the same candidate always gets
the same badges.

Two families are produced:

  status flags   🟢 Top Match · 👥 Bench Candidate · 🚀 Immediate Joiner ·
                 ⚠️ Incomplete Profile — pipeline state, one line each.
  skill badges   Verified skill / certification claims.

Every badge carries the evidence that justifies it (resume snippet, parsed
section, or external-profile signal) so a recruiter can click through to the
source. Nothing is emitted on evidence weaker than the thresholds below: an
unverifiable claim gets no badge rather than a badge with a shrug attached.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Mapping, Optional, Sequence

from app.services.evidence_tracker import evidence_tracker
from app.utils.validators import normalize_skill

BadgeTone = Literal["positive", "neutral", "warning"]
EvidenceOrigin = Literal["resume", "external_profile", "screening"]
BadgeLevel = Literal["verified", "corroborated"]

# --- Thresholds (single place to tune badge strictness) ---

TOP_MATCH_MIN_SCORE = 85.0
TOP_MATCH_MIN_SKILL_SCORE = 75.0
BENCH_MIN_SCORE = 60.0

#: Minimum confidence for a single resume snippet to stand on its own.
VERIFIED_MIN_CONFIDENCE = 0.7
#: Confidence credited to a skill inferred from a linked public profile.
EXTERNAL_PROFILE_CONFIDENCE = 0.6
#: Roughly one line of text — below this the extraction failed rather than
#: the resume being short, so there is nothing to cite evidence from.
MIN_RESUME_TEXT_CHARS = 60

#: Availability phrasings that mean "can start now". Ordered longest-first so
#: the more specific phrasing wins the snippet.
IMMEDIATE_JOINER_PATTERNS = (
    r"available\s+to\s+join\s+immediately",
    r"immediately\s+available",
    r"available\s+immediately",
    r"immediate\s+joiner",
    r"can\s+join\s+immediately",
    r"notice\s+period\s*[:\-]?\s*(?:none|nil|immediate|0\s*days?)",
    r"notice\s+period\s*[:\-]?\s*(?:7|10|14|15)\s*days?",
    r"currently\s+(?:on\s+the\s+bench|between\s+roles|serving\s+notice)",
)

#: enriched_profile keys that may carry an availability statement.
AVAILABILITY_KEYS = ("availability", "notice_period", "start_date")


@dataclass
class BadgeEvidence:
    """One pointer back to the data that justifies a badge."""

    label: str
    detail: str
    origin: EvidenceOrigin
    confidence: Optional[float] = None
    url: Optional[str] = None


@dataclass
class StatusFlag:
    id: str
    label: str
    emoji: str
    tone: BadgeTone
    reason: str
    evidence: list[BadgeEvidence] = field(default_factory=list)


@dataclass
class SkillBadge:
    name: str
    kind: Literal["skill", "certification"]
    level: BadgeLevel
    confidence: float
    evidence: list[BadgeEvidence] = field(default_factory=list)


@dataclass
class BadgeSet:
    status_flags: list[StatusFlag] = field(default_factory=list)
    skill_badges: list[SkillBadge] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "status_flags": [asdict(f) for f in self.status_flags],
            "skill_badges": [asdict(b) for b in self.skill_badges],
        }


def _skill_name(item: Any) -> str:
    """Skills arrive as bare strings or as {skill|skill_name, source} dicts."""
    if isinstance(item, Mapping):
        return str(item.get("skill") or item.get("skill_name") or "").strip()
    return str(item or "").strip()


def _profile_signals(candidate: Any) -> tuple[dict[str, str], Optional[str]]:
    """Skills inferred from linked public profiles, keyed by normalized name.

    Returns the map plus the profile URL the signals came from (GitHub is
    preferred over LinkedIn because its inference is code-derived).
    """
    enriched = getattr(candidate, "enriched_profile", None) or {}
    if not isinstance(enriched, Mapping):
        return {}, None
    url = getattr(candidate, "github_url", None) or getattr(candidate, "linkedin_url", None)
    inferred = enriched.get("inferred_skills") or []
    if not isinstance(inferred, Sequence) or isinstance(inferred, (str, bytes)):
        return {}, url
    signals = {}
    for item in inferred:
        name = _skill_name(item)
        if name:
            signals[normalize_skill(name)] = name
    return signals, url


def _missing_sections(candidate: Any) -> list[str]:
    """Profile sections a recruiter needs that this candidate has none of."""
    missing: list[str] = []
    if not (getattr(candidate, "skills", None) or []):
        missing.append("skills")
    if not (getattr(candidate, "experience", None) or []):
        missing.append("work experience")
    if not (getattr(candidate, "education", None) or []):
        missing.append("education")
    if not (getattr(candidate, "email", None) and getattr(candidate, "phone", None)):
        missing.append("contact details")
    resume_text = getattr(candidate, "resume_text", None) or ""
    if len(resume_text.strip()) < MIN_RESUME_TEXT_CHARS:
        missing.append("parsed resume text")
    return missing


def _availability_evidence(candidate: Any) -> Optional[BadgeEvidence]:
    """Find a statement that the candidate can start now, or None."""
    enriched = getattr(candidate, "enriched_profile", None) or {}
    if isinstance(enriched, Mapping):
        for key in AVAILABILITY_KEYS:
            stated = enriched.get(key)
            if not stated:
                continue
            text = str(stated)
            if any(re.search(p, text, re.IGNORECASE) for p in IMMEDIATE_JOINER_PATTERNS):
                return BadgeEvidence(
                    label=f"Profile · {key.replace('_', ' ')}",
                    detail=text.strip()[:200],
                    origin="external_profile",
                    confidence=0.9,
                )

    resume_text = getattr(candidate, "resume_text", None) or ""
    for pattern in IMMEDIATE_JOINER_PATTERNS:
        match = re.search(pattern, resume_text, re.IGNORECASE)
        if not match:
            continue
        start = max(0, match.start() - 50)
        end = min(len(resume_text), match.end() + 50)
        return BadgeEvidence(
            label="Resume · availability",
            detail=resume_text[start:end].replace("\n", " ").strip(),
            origin="resume",
            confidence=0.85,
        )
    return None


def _status_flags(
    candidate: Any,
    score: Optional[Mapping[str, Any]],
    missing: list[str],
) -> list[StatusFlag]:
    flags: list[StatusFlag] = []
    incomplete = bool(missing)

    if incomplete:
        flags.append(
            StatusFlag(
                id="incomplete_profile",
                label="Incomplete Profile",
                emoji="⚠️",
                tone="warning",
                reason=(
                    "Screening ran on partial data — missing "
                    f"{', '.join(missing)}. Ask the candidate to complete the profile "
                    "before relying on the match score."
                ),
                evidence=[
                    BadgeEvidence(
                        label="Profile completeness",
                        detail=f"No data parsed for: {', '.join(missing)}",
                        origin="screening",
                    )
                ],
            )
        )

    if score is not None:
        overall = float(score.get("overall_score") or 0.0)
        skill_score = float(score.get("skill_score") or 0.0)
        matched = [_skill_name(s) for s in (score.get("matched_skills") or [])]
        matched = [s for s in matched if s]
        missing_skills = [_skill_name(s) for s in (score.get("missing_skills") or [])]
        missing_skills = [s for s in missing_skills if s]

        score_evidence = BadgeEvidence(
            label="Match score",
            detail=(
                f"Overall {overall:.0f}/100 · skills {skill_score:.0f}/100 · "
                f"{len(matched)} required skills matched"
                + (f", {len(missing_skills)} missing" if missing_skills else "")
            ),
            origin="screening",
            confidence=round(overall / 100, 2),
        )

        # A top-match label on a half-parsed profile would overstate what was
        # actually verified, so completeness gates it.
        if (
            not incomplete
            and overall >= TOP_MATCH_MIN_SCORE
            and skill_score >= TOP_MATCH_MIN_SKILL_SCORE
        ):
            flags.append(
                StatusFlag(
                    id="top_match",
                    label="Top Match",
                    emoji="🟢",
                    tone="positive",
                    reason=(
                        f"Scores {overall:.0f}/100 against this role with a "
                        f"{skill_score:.0f}/100 skills match"
                        + (f" ({', '.join(matched[:4])})" if matched else "")
                        + " — shortlist candidate."
                    ),
                    evidence=[score_evidence],
                )
            )
        elif overall >= BENCH_MIN_SCORE:
            flags.append(
                StatusFlag(
                    id="bench_candidate",
                    label="Bench Candidate",
                    emoji="👥",
                    tone="neutral",
                    reason=(
                        f"Solid but not front-running at {overall:.0f}/100"
                        + (
                            f" — gaps in {', '.join(missing_skills[:3])}"
                            if missing_skills
                            else ""
                        )
                        + ". Worth keeping in the talent pool for related roles."
                    ),
                    evidence=[score_evidence],
                )
            )

    availability = _availability_evidence(candidate)
    if availability:
        flags.append(
            StatusFlag(
                id="immediate_joiner",
                label="Immediate Joiner",
                emoji="🚀",
                tone="positive",
                reason="States availability to start immediately or on short notice.",
                evidence=[availability],
            )
        )

    return flags


def _skill_badges(
    candidate: Any,
    score: Optional[Mapping[str, Any]],
) -> list[SkillBadge]:
    resume_text = getattr(candidate, "resume_text", None) or ""
    profile_skills, profile_url = _profile_signals(candidate)

    # Snippets the matcher already extracted, keyed by skill, so we reuse its
    # work instead of re-scanning the resume for those skills.
    tracked: dict[str, Mapping[str, Any]] = {}
    for item in (score or {}).get("evidence") or []:
        if not isinstance(item, Mapping):
            continue
        name = normalize_skill(str(item.get("skill_name") or ""))
        if name:
            tracked.setdefault(name, item)

    candidates_to_check: list[tuple[str, str]] = []
    seen: set[str] = set()

    def _queue(raw: Any, kind: str) -> None:
        name = _skill_name(raw)
        key = f"{kind}:{normalize_skill(name)}"
        if name and key not in seen:
            seen.add(key)
            candidates_to_check.append((name, kind))

    for item in (score or {}).get("matched_skills") or []:
        _queue(item, "skill")
    for item in getattr(candidate, "skills", None) or []:
        _queue(item, "skill")
    for item in getattr(candidate, "certifications", None) or []:
        _queue(item, "certification")

    badges: list[SkillBadge] = []
    for name, kind in candidates_to_check:
        key = normalize_skill(name)
        evidence: list[BadgeEvidence] = []
        best_confidence = 0.0

        item = tracked.get(key)
        if item:
            snippet = str(item.get("resume_text_snippet") or "").strip()
            confidence = float(item.get("confidence_score") or 0.0)
        else:
            snippet, section, confidence = evidence_tracker.find_snippet(resume_text, name)
            snippet = (snippet or "").strip()
            item = {"source_section": section} if snippet else None

        if item and snippet and confidence >= VERIFIED_MIN_CONFIDENCE:
            evidence.append(
                BadgeEvidence(
                    label=f"Resume · {item.get('source_section') or 'Unknown'}",
                    detail=snippet,
                    origin="resume",
                    confidence=round(confidence, 2),
                )
            )
            best_confidence = max(best_confidence, confidence)

        if key in profile_skills:
            evidence.append(
                BadgeEvidence(
                    label="Linked public profile",
                    detail=f"{profile_skills[key]} inferred from the candidate's public profile",
                    origin="external_profile",
                    confidence=EXTERNAL_PROFILE_CONFIDENCE,
                    url=profile_url,
                )
            )
            best_confidence = max(best_confidence, EXTERNAL_PROFILE_CONFIDENCE)

        # One strong resume snippet, or two independent weaker sources.
        if not evidence or (len(evidence) == 1 and best_confidence < VERIFIED_MIN_CONFIDENCE):
            continue

        badges.append(
            SkillBadge(
                name=name,
                kind="certification" if kind == "certification" else "skill",
                level="corroborated" if len(evidence) > 1 else "verified",
                confidence=round(min(0.99, best_confidence + 0.1 * (len(evidence) - 1)), 2),
                evidence=evidence,
            )
        )

    badges.sort(key=lambda b: (b.kind != "certification", -b.confidence, b.name.lower()))
    return badges


def build_badges(candidate: Any, score: Optional[Mapping[str, Any]] = None) -> BadgeSet:
    """Status flags and skill badges for one candidate.

    `score` is a scoring result from `CandidateMatcher.score_candidate`. Pass
    None for job-independent badges (availability, completeness, verified
    skills) — the match-dependent flags are simply omitted.
    """
    missing = _missing_sections(candidate)
    return BadgeSet(
        status_flags=_status_flags(candidate, score, missing),
        skill_badges=_skill_badges(candidate, score),
    )
