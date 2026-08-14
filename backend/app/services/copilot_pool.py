"""Build the scored candidate pool the copilot agent operates on."""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from app.models.schemas import WeightConfig


def level_from_years(years: float) -> str:
    if years >= 8:
        return "lead"
    if years >= 5:
        return "senior"
    if years >= 2:
        return "mid"
    return "junior"


def score_of(categories: dict[str, float], weights: WeightConfig) -> float:
    total_weight = (
        weights.skills
        + weights.experience
        + weights.education
        + weights.certifications
        + weights.projects
    ) or 1.0
    return round(
        (
            categories["skills"] * weights.skills
            + categories["experience"] * weights.experience
            + categories["education"] * weights.education
            + categories["certifications"] * weights.certifications
            + categories["projects"] * weights.projects
        )
        / total_weight,
        2,
    )


def job_requirements(job: Any) -> list[dict[str, Any]]:
    """Derive structured requirements from a JobPosting for copilot tools."""
    requirements: list[dict[str, Any]] = []
    idx = 0
    for skill in job.required_skills or []:
        text = str(skill)
        requirements.append(
            {
                "id": f"req-{idx}",
                "category": "Skills",
                "text": text,
                "must": True,
                "keywords": [text.lower()],
            }
        )
        idx += 1
    for skill in job.nice_to_have_skills or []:
        text = str(skill)
        requirements.append(
            {
                "id": f"req-{idx}",
                "category": "Skills",
                "text": text,
                "must": False,
                "keywords": [text.lower()],
            }
        )
        idx += 1
    if job.required_experience_years:
        years = int(job.required_experience_years)
        requirements.append(
            {
                "id": f"req-{idx}",
                "category": "Experience",
                "text": f"{years}+ years experience",
                "must": True,
                "keywords": ["experience", "years"],
                "minYears": years,
            }
        )
        idx += 1
    if job.education_requirements:
        requirements.append(
            {
                "id": f"req-{idx}",
                "category": "Education",
                "text": str(job.education_requirements)[:80],
                "must": True,
                "keywords": re.findall(r"[a-z]{3,}", str(job.education_requirements).lower())[:6],
            }
        )
    return requirements


def resolve_pool_member(pool: list[dict[str, Any]], ref: str) -> dict[str, Any] | None:
    """Resolve a pool label or candidate id to its pool member.

    Single shared implementation used by both tool dispatch
    (`copilot_agent.run_copilot_tool`) and focus-candidate resolution
    (`copilot_agent.copilot_answer`'s `focus_candidate_id` handling).
    """
    for member in pool:
        if member.get("label") == ref or str(member.get("id")) == ref:
            return member
    return None


def _evidence_items(score: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for item in score.get("evidence") or []:
        if not isinstance(item, dict):
            continue
        eid = str(item.get("id") or item.get("evidence_id") or f"ev-{len(items)}")
        items.append(
            {
                "id": eid,
                "skill": item.get("skill_name") or item.get("skill") or "",
                "detail": item.get("resume_text_snippet") or item.get("detail") or "",
                "source": item.get("source_section") or item.get("source") or "Resume",
            }
        )
    return items


def _gaps(score: dict[str, Any]) -> list[str]:
    missing = score.get("missing_skills") or []
    gaps: list[str] = []
    for item in missing:
        if isinstance(item, dict):
            gaps.append(str(item.get("skill") or item))
        else:
            gaps.append(str(item))
    weaknesses = score.get("weaknesses")
    if isinstance(weaknesses, str) and weaknesses.strip():
        gaps.append(weaknesses.strip())
    return gaps[:5]


def _strengths(score: dict[str, Any]) -> list[str]:
    raw = score.get("strengths")
    if isinstance(raw, list):
        return [str(s) for s in raw if s][:3]
    if isinstance(raw, str) and raw.strip():
        return [raw.strip()]
    matched = score.get("matched_skills") or []
    return [
        str(m.get("skill") if isinstance(m, dict) else m)
        for m in matched[:3]
        if m
    ]


def _verdicts(score: dict[str, Any], requirements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    matched = {
        str(m.get("skill") if isinstance(m, dict) else m).lower()
        for m in (score.get("matched_skills") or [])
    }
    missing = {
        str(m.get("skill") if isinstance(m, dict) else m).lower()
        for m in (score.get("missing_skills") or [])
    }
    evidence = _evidence_items(score)
    verdicts: list[dict[str, Any]] = []
    for req in requirements:
        text = str(req.get("text", "")).lower()
        status = "missing"
        req_score = 20
        if any(text in m or m in text for m in matched):
            status = "met"
            req_score = 90
        elif any(text in m or m in text for m in missing):
            status = "partial"
            req_score = 45
        verdicts.append(
            {
                "requirementId": req["id"],
                "status": status,
                "score": req_score,
                "evidence": None,
                "evidenceItems": evidence[:1],
            }
        )
    return verdicts


def build_pool(
    ranked: list[dict[str, Any]],
    *,
    weights: WeightConfig,
    blind: bool,
    requirements: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    pool: list[dict[str, Any]] = []
    for score in ranked:
        categories = {
            "skills": float(score.get("skill_score") or 0),
            "experience": float(score.get("experience_score") or 0),
            "education": float(score.get("education_score") or 0),
            "certifications": float(score.get("certification_score") or 0),
            "projects": float(score.get("project_score") or 0),
        }
        years = float(score.get("years") or score.get("years_of_experience") or 0)
        matched = score.get("matched_skills") or []
        missing = score.get("missing_skills") or []
        must_total = len([r for r in requirements if r.get("must")]) or len(matched) + len(missing)
        must_met = max(0, must_total - len(missing))
        label = str(score.get("name") or "Unknown")
        cid = str(score.get("candidate_id") or score.get("id") or "")
        pool.append(
            {
                "id": cid,
                "label": label,
                "rank": 0,
                "score": score_of(categories, weights),
                "years": years,
                "level": level_from_years(years),
                "categories": categories,
                "mustHaves": {"met": must_met, "total": must_total},
                "skills": [
                    str(s.get("skill") if isinstance(s, dict) else s)
                    for s in (score.get("skills") or matched or [])
                ],
                "strengths": _strengths(score),
                "gaps": _gaps(score),
                "summary": score.get("strengths") or f"Overall score {score.get('overall_score', 0)}",
                "verdicts": _verdicts(score, requirements),
                "evidence": _evidence_items(score),
            }
        )

    pool.sort(key=lambda c: (-c["score"], c["label"]))
    result: list[dict[str, Any]] = []
    for i, candidate in enumerate(pool, start=1):
        row = {**candidate, "rank": i}
        if blind:
            row["label"] = f"Candidate #{i}"
        result.append(row)
    return result


def extract_candidate_ids(answer: str, pool: list[dict[str, Any]]) -> list[UUID]:
    found: list[UUID] = []
    lower = answer.lower()
    for member in pool:
        label = str(member.get("label", "")).lower()
        if label and label in lower and not label.startswith("candidate #"):
            try:
                found.append(UUID(str(member["id"])))
            except ValueError:
                continue
    for match in re.findall(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        answer,
        flags=re.IGNORECASE,
    ):
        try:
            found.append(UUID(match))
        except ValueError:
            continue
    seen: set[UUID] = set()
    ordered: list[UUID] = []
    for cid in found:
        if cid not in seen:
            seen.add(cid)
            ordered.append(cid)
    return ordered[:10]
