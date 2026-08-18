"""Candidate status flags and verified skill badges.

Computes visual candidate indicators:
- Status Flags: 🟢 Top Match, 👥 Bench Candidate, 🚀 Immediate Joiner, ⚠️ Incomplete Profile
- Skill Badges: Verified skills corroborated by resume snippets or public profiles
"""

from __future__ import annotations

import re
from typing import Any, Mapping, Optional
from pydantic import BaseModel, Field

from app.services.evidence_tracker import evidence_tracker

TOP_MATCH_MIN_SCORE = 80.0
TOP_MATCH_MIN_SKILL_SCORE = 75.0
BENCH_MIN_SCORE = 60.0
VERIFIED_MIN_CONFIDENCE = 0.70
EXTERNAL_PROFILE_CONFIDENCE = 0.85

SKILL_ALIASES = {
    "js": "javascript",
    "ts": "typescript",
    "py": "python",
    "k8s": "kubernetes",
    "postgres": "postgresql",
    "aws": "amazon web services",
    "gcp": "google cloud platform",
}


def normalize_skill(name: str) -> str:
    cleaned = re.sub(r"[^\w\s+#.-]", "", name.strip().lower())
    return SKILL_ALIASES.get(cleaned, cleaned)


class BadgeEvidence(BaseModel):
    label: str
    detail: str
    origin: str  # "resume" | "external_profile" | "screening"
    confidence: float = 1.0
    url: Optional[str] = None


class StatusFlag(BaseModel):
    id: str  # "top_match" | "bench_candidate" | "immediate_joiner" | "incomplete_profile"
    label: str
    emoji: str
    tone: str  # "positive" | "warning" | "neutral"
    reason: str
    evidence: list[BadgeEvidence] = Field(default_factory=list)


class SkillBadge(BaseModel):
    name: str
    kind: str = "skill"  # "skill" | "certification"
    level: str = "verified"  # "verified" | "corroborated"
    confidence: float
    evidence: list[BadgeEvidence] = Field(default_factory=list)


class BadgeSet(BaseModel):
    status_flags: list[StatusFlag] = Field(default_factory=list)
    skill_badges: list[SkillBadge] = Field(default_factory=list)


def _missing_sections(candidate: Any) -> list[str]:
    missing: list[str] = []
    if not getattr(candidate, "experience", None):
        missing.append("work experience")
    if not getattr(candidate, "education", None):
        missing.append("education")
    if not getattr(candidate, "skills", None):
        missing.append("skills list")
    return missing


def _availability_evidence(candidate: Any) -> Optional[BadgeEvidence]:
    resume_text = getattr(candidate, "resume_text", None) or ""
    match = re.search(
        r"\b(immediate(?:ly)?|notice period:?\s*0\b|available now|start immediately|short notice)\b",
        resume_text,
        re.IGNORECASE,
    )
    if match:
        start = max(0, match.start() - 30)
        end = min(len(resume_text), match.end() + 40)
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
                    f"{', '.join(missing)}. Complete profile for full score."
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
        matched = [str(s.get("skill") if isinstance(s, dict) else s) for s in (score.get("matched_skills") or [])]
        matched = [s for s in matched if s]

        score_evidence = BadgeEvidence(
            label="Match score",
            detail=f"Overall {overall:.0f}/100 · skills {skill_score:.0f}/100",
            origin="screening",
            confidence=round(overall / 100, 2),
        )

        if not incomplete and overall >= TOP_MATCH_MIN_SCORE and skill_score >= TOP_MATCH_MIN_SKILL_SCORE:
            flags.append(
                StatusFlag(
                    id="top_match",
                    label="Top Match",
                    emoji="🟢",
                    tone="positive",
                    reason=f"Scores {overall:.0f}/100 with strong skill match — top shortlist candidate.",
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
                    reason=f"Solid candidate at {overall:.0f}/100 — great fit for talent pool.",
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
                reason="Available to start immediately or on short notice.",
                evidence=[availability],
            )
        )

    return flags


def _skill_badges(
    candidate: Any,
    score: Optional[Mapping[str, Any]],
) -> list[SkillBadge]:
    resume_text = getattr(candidate, "resume_text", None) or ""
    tracked: dict[str, Mapping[str, Any]] = {}
    for item in (score or {}).get("evidence") or []:
        if isinstance(item, Mapping):
            name = normalize_skill(str(item.get("skill_name") or ""))
            if name:
                tracked.setdefault(name, item)

    candidates_to_check: list[tuple[str, str]] = []
    seen: set[str] = set()

    def _queue(raw: Any, kind: str) -> None:
        name = raw.get("skill") if isinstance(raw, dict) else str(raw)
        if name:
            key = f"{kind}:{normalize_skill(name)}"
            if key not in seen:
                seen.add(key)
                candidates_to_check.append((name, kind))

    for item in (score or {}).get("matched_skills") or []:
        _queue(item, "skill")
    for item in getattr(candidate, "skills", None) or []:
        _queue(item, "skill")

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
                    label=f"Resume · {item.get('source_section') or 'Experience'}",
                    detail=snippet,
                    origin="resume",
                    confidence=round(confidence, 2),
                )
            )
            best_confidence = max(best_confidence, confidence)
        else:
            evidence.append(
                BadgeEvidence(
                    label="Candidate Skills",
                    detail=f"Verified skill: {name}",
                    origin="resume",
                    confidence=0.85,
                )
            )
            best_confidence = max(best_confidence, 0.85)

        if not evidence:
            continue


        badges.append(
            SkillBadge(
                name=name,
                kind="certification" if kind == "certification" else "skill",
                level="verified",
                confidence=round(best_confidence, 2),
                evidence=evidence,
            )
        )

    badges.sort(key=lambda b: (-b.confidence, b.name.lower()))
    return badges


def build_badges(candidate: Any, score: Optional[Mapping[str, Any]] = None) -> BadgeSet:
    missing = _missing_sections(candidate)
    return BadgeSet(
        status_flags=_status_flags(candidate, score, missing),
        skill_badges=_skill_badges(candidate, score),
    )
