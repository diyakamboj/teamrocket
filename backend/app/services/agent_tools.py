"""Deterministic Recruiter Copilot tools over a scored candidate pool.

The model only *selects* a tool. Each tool reads the already-scored pool and
returns compact structured data plus evidence IDs. Citations are resolved
later from those IDs so the model cannot invent resume evidence.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Optional
from uuid import UUID

from app.utils.validators import normalize_skill, redact_identity

TOOL_NAMES = (
    "search_candidates",
    "get_verdicts",
    "compare",
    "gap_summary",
    "must_have_report",
    "clarify",
)

EVIDENCE_MARK = re.compile(
    r"\[(?:evidence|eid|src):?\s*"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]",
    re.IGNORECASE,
)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

_STOP = {
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "have",
    "has",
    "who",
    "what",
    "show",
    "find",
    "me",
    "a",
    "an",
    "of",
    "to",
    "in",
    "on",
    "is",
    "are",
    "should",
    "i",
    "we",
    "our",
    "job",
    "role",
    "candidate",
    "candidates",
    "please",
    "about",
    "how",
    "does",
    "look",
}


def is_uuid(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(_UUID_RE.match(text))


def skill_label(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("skill") or item.get("skill_name") or "").strip()
    return str(item or "").strip()


def display_name(row: dict[str, Any], blind_mode: bool) -> str:
    if blind_mode:
        rank = row.get("rank")
        return f"Candidate #{rank}" if rank is not None else "Candidate"
    return str(row.get("name") or "Candidate")


def compact_row(row: dict[str, Any], blind_mode: bool) -> dict[str, Any]:
    identity_names = [str(row.get("legal_name") or ""), str(row.get("name") or "")]
    evidence = []
    for item in row.get("evidence") or []:
        eid = str(item.get("id") or "")
        if not is_uuid(eid):
            continue
        snippet = item.get("resume_text_snippet") or ""
        if blind_mode:
            snippet = redact_identity(snippet, identity_names)
        evidence.append(
            {
                "id": eid.lower(),
                "skill_name": item.get("skill_name"),
                "resume_text_snippet": snippet,
                "source_section": item.get("source_section"),
                "confidence_score": item.get("confidence_score"),
                "candidate_id": str(row.get("candidate_id") or ""),
            }
        )
    name = display_name(row, blind_mode)
    return {
        "candidate_id": str(row.get("candidate_id") or ""),
        "display_name": name,
        "rank": row.get("rank"),
        "overall_score": row.get("overall_score"),
        "skill_score": row.get("skill_score"),
        "experience_score": row.get("experience_score"),
        "education_score": row.get("education_score"),
        "certification_score": row.get("certification_score"),
        "project_score": row.get("project_score"),
        "matched_skills": [skill_label(s) for s in (row.get("matched_skills") or []) if skill_label(s)],
        "missing_skills": [skill_label(s) for s in (row.get("missing_skills") or []) if skill_label(s)],
        "strengths": redact_identity(row.get("strengths") or "", identity_names)
        if blind_mode
        else row.get("strengths"),
        "weaknesses": redact_identity(row.get("weaknesses") or "", identity_names)
        if blind_mode
        else row.get("weaknesses"),
        "evidence": evidence,
        "evidence_ids": [e["id"] for e in evidence],
    }


def parse_uuid_list(values: Optional[list[Any]]) -> list[UUID]:
    found: list[UUID] = []
    for value in values or []:
        text = str(value).strip()
        if not is_uuid(text):
            continue
        try:
            found.append(UUID(text))
        except ValueError:
            continue
    return found


def match_focus(
    pool: list[dict[str, Any]],
    *,
    candidate_ids: Optional[list[Any]] = None,
    focus_names: Optional[list[str]] = None,
    query: str = "",
) -> list[dict[str, Any]]:
    """Resolve recruiter focus from IDs, names, or names mentioned in the query."""
    by_id = {str(row.get("candidate_id")).lower(): row for row in pool}
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()

    for cid in parse_uuid_list(candidate_ids):
        row = by_id.get(str(cid).lower())
        if row and str(row["candidate_id"]).lower() not in seen:
            selected.append(row)
            seen.add(str(row["candidate_id"]).lower())

    names = [n.strip().lower() for n in (focus_names or []) if n and n.strip()]
    haystack = f"{query} {' '.join(names)}".lower()
    if haystack.strip():
        for row in pool:
            name = str(row.get("name") or "").lower()
            if not name or str(row.get("candidate_id")).lower() in seen:
                continue
            parts = [p for p in name.split() if len(p) > 2]
            if name in haystack or (parts and all(p in haystack for p in parts[:2])):
                selected.append(row)
                seen.add(str(row["candidate_id"]).lower())
            elif parts and parts[0] in haystack:
                selected.append(row)
                seen.add(str(row["candidate_id"]).lower())

    return selected


def select_tool_heuristic(
    query: str,
    *,
    focus_count: int = 0,
    history_text: str = "",
) -> tuple[str, dict[str, Any]]:
    """Deterministic router used when Azure is down or the model returns invalid JSON."""
    raw = (query or "").strip()
    q = raw.lower()
    blob = f"{q} {history_text.lower()}".strip()

    if not q or len(q) < 3 or q in {"?", "help", "asdf", "asdfgh", "idk", "...", "hmm", "n/a"}:
        return "clarify", {"reason": "empty_or_gibberish"}
    if re.fullmatch(r"[^a-z0-9]+", q) or len(re.findall(r"[a-z]{3,}", q)) == 0:
        return "clarify", {"reason": "unintelligible"}

    if any(
        token in blob
        for token in (
            "compare",
            " vs ",
            "versus",
            "side by side",
            "side-by-side",
            "difference between",
            "trade-off",
            "tradeoff",
            "them against",
        )
    ):
        return "compare", {}
    if any(
        token in q
        for token in (
            "must-have",
            "must have",
            "must haves",
            "required skill",
            "hard requirement",
            "knockout",
            "meets all",
            "who meets",
        )
    ):
        return "must_have_report", {}
    if any(
        token in q
        for token in (
            "skill gap",
            "gaps",
            "gap ",
            "missing skill",
            "qualification gap",
            "lacking",
            "pipeline",
            "biggest gap",
        )
    ):
        return "gap_summary", {}
    if any(
        token in q
        for token in (
            "verdict",
            "should i interview",
            "move to interview",
            "recommend",
            "strongest",
            "best fit",
            "who should",
            "next interview",
            "hire",
            "advance",
        )
    ):
        return "get_verdicts", {}
    if any(
        token in q
        for token in (
            "find",
            "search",
            "who has",
            "show me",
            "developers",
            "candidates with",
            "top ",
            "python",
            "filter",
        )
    ):
        return "search_candidates", {"query": raw, "limit": 5}
    if focus_count == 1:
        return "get_verdicts", {}
    if focus_count >= 2:
        return "compare", {}
    if any(token in q for token in ("this job", "this role", "open jobs", "attention")):
        return "gap_summary", {}
    if len(q.split()) <= 2 and q not in {"compare", "gaps", "search"}:
        return "clarify", {"reason": "ambiguous"}
    return "search_candidates", {"query": raw, "limit": 5}


def execute_tool(
    name: str,
    args: Optional[dict[str, Any]],
    *,
    pool: list[dict[str, Any]],
    job: dict[str, Any],
    focus: list[dict[str, Any]],
    blind_mode: bool,
    query: str,
) -> dict[str, Any]:
    args = args or {}
    if name not in TOOL_NAMES:
        name = "clarify"
        args = {"reason": "unknown_tool"}

    dispatch = {
        "search_candidates": _search_candidates,
        "get_verdicts": _get_verdicts,
        "compare": _compare,
        "gap_summary": _gap_summary,
        "must_have_report": _must_have_report,
        "clarify": _clarify,
    }
    payload = dispatch[name](
        pool=pool,
        job=job,
        focus=focus,
        blind_mode=blind_mode,
        query=query,
        args=args,
    )
    compact_candidates = payload.get("candidates") or []
    evidence_index = _evidence_index(compact_candidates)
    candidate_ids = [c.get("candidate_id") for c in compact_candidates if c.get("candidate_id")]
    return {
        "tool": name,
        "ok": payload.get("ok", True),
        "headline": payload.get("headline") or "",
        "payload": payload,
        "evidence_index": evidence_index,
        "candidate_ids": candidate_ids,
    }


def format_tool_result(result: dict[str, Any]) -> str:
    """Recruiter-facing markdown used when Azure synthesis is unavailable."""
    payload = result.get("payload") or {}
    tool = result.get("tool")
    if tool == "clarify" or not payload.get("ok", True):
        return payload.get("message") or (
            "I can search the scored pool, give verdicts, compare candidates, "
            "summarize skill gaps, or report must-have coverage. Try a more specific question."
        )

    lines: list[str] = []
    headline = payload.get("headline")
    if headline:
        lines.append(f"**{headline}**")
        lines.append("")

    if tool == "search_candidates":
        for row in payload.get("candidates") or []:
            matched = ", ".join(row.get("matched_skills") or []) or "no required-skill overlap"
            lines.append(
                f"- **{row['display_name']}** (#{row.get('rank')}, score {row.get('overall_score')}) — {matched}"
            )
            lines.extend(_evidence_lines(row, limit=2))
    elif tool == "get_verdicts":
        for row in payload.get("candidates") or []:
            lines.append(
                f"- **{row['display_name']}** — {row.get('verdict')} "
                f"(score {row.get('overall_score')})"
            )
            missing = row.get("missing_skills") or []
            if missing:
                lines.append(f"  - Missing: {', '.join(missing[:4])}")
            lines.extend(_evidence_lines(row, limit=2))
        nxt = payload.get("next_step")
        if nxt:
            lines.append("")
            lines.append(f"**Next step:** {nxt}")
    elif tool == "compare":
        for row in payload.get("candidates") or []:
            lines.append(
                f"- **{row['display_name']}** — overall {row.get('overall_score')} · "
                f"skills {row.get('skill_score')} · experience {row.get('experience_score')}"
            )
            if row.get("missing_skills"):
                lines.append(f"  - Gaps: {', '.join(row['missing_skills'][:4])}")
            lines.extend(_evidence_lines(row, limit=1))
        rec = payload.get("recommendation")
        if rec:
            lines.append("")
            lines.append(f"**Recommendation:** {rec}")
    elif tool == "gap_summary":
        lines.append(
            f"Pool: {payload.get('pool_size', 0)} candidates · "
            f"average score {payload.get('average_score', 0)}"
        )
        for gap in payload.get("gaps") or []:
            lines.append(
                f"- **{gap['skill']}** missing for {gap['missing_count']}/{payload.get('pool_size', 0)} "
                f"({gap['missing_pct']}%)"
            )
        if payload.get("note"):
            lines.append("")
            lines.append(payload["note"])
    elif tool == "must_have_report":
        lines.append(
            f"Must-haves: {', '.join(payload.get('must_haves') or []) or 'none listed'}"
        )
        for skill in payload.get("by_skill") or []:
            have = ", ".join(skill.get("have_names") or []) or "nobody"
            lines.append(f"- **{skill['skill']}** — have: {have}")
            for eid in skill.get("evidence_ids") or []:
                lines.append(f"  [evidence:{eid}]")
        full = payload.get("full_match_names") or []
        lines.append("")
        if full:
            lines.append(f"**Meets every must-have:** {', '.join(full)}")
        else:
            lines.append("**No candidate currently meets every must-have.**")

    body = "\n".join(line for line in lines if line is not None).strip()
    return body or "No matching candidates in the scored pool for this job."


def resolve_citations(
    text: str,
    allowed: dict[str, dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """Replace evidence markers with skill labels; drop IDs that are not in-pool."""
    citations: list[dict[str, Any]] = []
    seen: set[str] = set()
    normalized = {k.lower(): v for k, v in allowed.items()}

    def _replace(match: re.Match[str]) -> str:
        eid = match.group(1).lower()
        item = normalized.get(eid)
        if not item:
            return ""
        if eid not in seen:
            seen.add(eid)
            citations.append(
                {
                    "id": eid,
                    "title": item.get("skill_name") or "Evidence",
                    "snippet": item.get("resume_text_snippet") or "",
                    "score": item.get("confidence_score"),
                    "metadata": {
                        "source_section": item.get("source_section"),
                        "candidate_id": item.get("candidate_id"),
                        "evidence_id": eid,
                    },
                }
            )
        label = item.get("skill_name") or "evidence"
        return f"[{label}]"

    cleaned = EVIDENCE_MARK.sub(_replace, text or "")
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, citations


def attach_default_citations(
    citations: list[dict[str, Any]],
    allowed: dict[str, dict[str, Any]],
    limit: int = 5,
) -> list[dict[str, Any]]:
    if citations:
        return citations[:limit]
    extras: list[dict[str, Any]] = []
    for eid, item in list(allowed.items())[:limit]:
        extras.append(
            {
                "id": eid,
                "title": item.get("skill_name") or "Evidence",
                "snippet": item.get("resume_text_snippet") or "",
                "score": item.get("confidence_score"),
                "metadata": {
                    "source_section": item.get("source_section"),
                    "candidate_id": item.get("candidate_id"),
                    "evidence_id": eid,
                },
            }
        )
    return extras


def _evidence_lines(row: dict[str, Any], limit: int = 2) -> list[str]:
    lines: list[str] = []
    for ev in (row.get("evidence") or [])[:limit]:
        snippet = (ev.get("resume_text_snippet") or "").strip()
        skill = ev.get("skill_name") or "evidence"
        marker = f"[evidence:{ev['id']}]"
        if snippet:
            lines.append(f"  - {marker} {skill}: {snippet}")
        else:
            lines.append(f"  - {marker} {skill}")
    return lines


def _evidence_index(candidates: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for row in candidates:
        for ev in row.get("evidence") or []:
            eid = str(ev.get("id") or "").lower()
            if is_uuid(eid):
                index[eid] = ev
    return index


def _verdict_for(score: Optional[float]) -> str:
    value = float(score or 0)
    if value >= 80:
        return "Strong fit"
    if value >= 55:
        return "Moderate fit"
    return "Weak fit"


def _required_skills(job: dict[str, Any]) -> list[str]:
    return [str(s) for s in (job.get("required_skills") or []) if str(s).strip()]


def _search_candidates(**kwargs: Any) -> dict[str, Any]:
    pool: list[dict[str, Any]] = kwargs["pool"]
    job: dict[str, Any] = kwargs["job"]
    focus: list[dict[str, Any]] = kwargs["focus"]
    blind_mode: bool = kwargs["blind_mode"]
    query: str = kwargs["query"]
    args: dict[str, Any] = kwargs["args"]

    source = focus or pool
    limit = int(args.get("limit") or 5)
    limit = max(1, min(limit, 10))
    min_score = float(args.get("min_score") or 0)
    requested_skills = [str(s) for s in (args.get("skills") or []) if str(s).strip()]
    tokens = _query_tokens(f"{query} {args.get('query') or ''}")
    catalog = _skill_catalog(pool, job)
    skill_filters = [s for s in requested_skills if s] or [
        skill for skill in catalog if normalize_skill(skill) in tokens or skill.lower() in (query or "").lower()
    ]

    ranked = []
    for row in source:
        if float(row.get("overall_score") or 0) < min_score:
            continue
        hay = " ".join(
            [
                str(row.get("name") or ""),
                " ".join(skill_label(s) for s in (row.get("matched_skills") or [])),
                " ".join(str(s) for s in (row.get("skills") or [])),
            ]
        ).lower()
        if skill_filters and not any(normalize_skill(s) in normalize_skill(hay) for s in skill_filters):
            # still allow if query is generic "top python developers" and python is in matched
            if not any(s.lower() in hay for s in skill_filters):
                continue
        ranked.append(row)

    if not ranked:
        ranked = [row for row in source if float(row.get("overall_score") or 0) >= min_score] or source
    ranked = sorted(ranked, key=lambda r: float(r.get("overall_score") or 0), reverse=True)[:limit]
    candidates = [compact_row(r, blind_mode) for r in ranked]
    title = job.get("title") or "this role"
    if candidates:
        headline = f"Top {len(candidates)} scored candidate{'s' if len(candidates) != 1 else ''} for {title}"
    else:
        headline = f"No scored candidates for {title}"
    return {"ok": True, "headline": headline, "candidates": candidates}


def _get_verdicts(**kwargs: Any) -> dict[str, Any]:
    pool: list[dict[str, Any]] = kwargs["pool"]
    focus: list[dict[str, Any]] = kwargs["focus"]
    blind_mode: bool = kwargs["blind_mode"]
    job: dict[str, Any] = kwargs["job"]

    source = focus or pool[:5]
    candidates = []
    for row in source:
        card = compact_row(row, blind_mode)
        card["verdict"] = _verdict_for(row.get("overall_score"))
        candidates.append(card)
    candidates = sorted(candidates, key=lambda c: float(c.get("overall_score") or 0), reverse=True)
    top = candidates[0] if candidates else None
    next_step = None
    if top:
        next_step = (
            f"Interview {top['display_name']} next — highest score in this set "
            f"({top.get('overall_score')})."
        )
    headline = (
        f"Verdicts for {job.get('title') or 'this role'}"
        if candidates
        else "No candidates available for a verdict"
    )
    return {
        "ok": bool(candidates),
        "headline": headline,
        "candidates": candidates,
        "next_step": next_step,
        "message": None if candidates else "There are no scored candidates to evaluate yet.",
    }


def _compare(**kwargs: Any) -> dict[str, Any]:
    pool: list[dict[str, Any]] = kwargs["pool"]
    focus: list[dict[str, Any]] = kwargs["focus"]
    blind_mode: bool = kwargs["blind_mode"]

    source = focus if len(focus) >= 2 else pool[:3]
    if len(source) < 2:
        return {
            "ok": False,
            "headline": "Need at least two candidates to compare",
            "candidates": [compact_row(r, blind_mode) for r in source],
            "message": (
                "Select at least two candidates — from Ranking, Comparison, or by name — "
                "and ask me to compare them."
            ),
        }
    source = source[:5]
    candidates = [compact_row(r, blind_mode) for r in source]
    candidates = sorted(candidates, key=lambda c: float(c.get("overall_score") or 0), reverse=True)
    best = candidates[0]
    runner = candidates[1] if len(candidates) > 1 else None
    gap = round(float(best.get("overall_score") or 0) - float((runner or {}).get("overall_score") or 0), 2)
    rec = f"{best['display_name']} is the stronger overall fit (score {best.get('overall_score')}"
    if runner:
        rec += f", +{gap} vs {runner['display_name']}"
    rec += ")."
    names = " vs ".join(c["display_name"] for c in candidates)
    return {
        "ok": True,
        "headline": f"Comparison: {names}",
        "candidates": candidates,
        "recommendation": rec,
    }


def _gap_summary(**kwargs: Any) -> dict[str, Any]:
    pool: list[dict[str, Any]] = kwargs["pool"]
    job: dict[str, Any] = kwargs["job"]
    blind_mode: bool = kwargs["blind_mode"]

    required = _required_skills(job)
    missing_counter: Counter[str] = Counter()
    for row in pool:
        missing = [skill_label(s) for s in (row.get("missing_skills") or []) if skill_label(s)]
        if not missing and required:
            have = {normalize_skill(skill_label(s)) for s in (row.get("matched_skills") or [])}
            missing = [s for s in required if normalize_skill(s) not in have]
        for skill in missing:
            missing_counter[skill] += 1

    size = len(pool) or 1
    scores = [float(r.get("overall_score") or 0) for r in pool]
    avg = round(sum(scores) / len(scores), 2) if scores else 0.0
    gaps = [
        {
            "skill": skill,
            "missing_count": count,
            "missing_pct": round((count / size) * 100, 1),
        }
        for skill, count in missing_counter.most_common(8)
    ]
    top = sorted(pool, key=lambda r: float(r.get("overall_score") or 0), reverse=True)[:3]
    note = None
    if gaps:
        worst = gaps[0]
        note = (
            f"Biggest gap is **{worst['skill']}** "
            f"({worst['missing_count']} of {len(pool)} candidates)."
        )
    return {
        "ok": True,
        "headline": f"Skill-gap summary for {job.get('title') or 'this role'}",
        "pool_size": len(pool),
        "average_score": avg,
        "gaps": gaps,
        "note": note,
        "candidates": [compact_row(r, blind_mode) for r in top],
        "required_skills": required,
    }


def _must_have_report(**kwargs: Any) -> dict[str, Any]:
    pool: list[dict[str, Any]] = kwargs["pool"]
    job: dict[str, Any] = kwargs["job"]
    blind_mode: bool = kwargs["blind_mode"]
    args: dict[str, Any] = kwargs["args"]
    focus: list[dict[str, Any]] = kwargs["focus"]

    source = focus or pool
    must = [str(s) for s in (args.get("skills") or []) if str(s).strip()] or _required_skills(job)
    by_skill: list[dict[str, Any]] = []
    full_match: list[dict[str, Any]] = []

    for row in source:
        have_norm = {normalize_skill(skill_label(s)) for s in (row.get("matched_skills") or [])}
        extra = {normalize_skill(str(s)) for s in (row.get("skills") or []) if s}
        have_norm |= extra
        if must and all(normalize_skill(s) in have_norm for s in must):
            full_match.append(row)

    for skill in must:
        have_rows = []
        evidence_ids: list[str] = []
        for row in source:
            have_norm = {normalize_skill(skill_label(s)) for s in (row.get("matched_skills") or [])}
            have_norm |= {normalize_skill(str(s)) for s in (row.get("skills") or []) if s}
            if normalize_skill(skill) not in have_norm:
                continue
            have_rows.append(row)
            for ev in row.get("evidence") or []:
                if normalize_skill(str(ev.get("skill_name") or "")) == normalize_skill(skill) and is_uuid(
                    ev.get("id")
                ):
                    evidence_ids.append(str(ev["id"]).lower())
        by_skill.append(
            {
                "skill": skill,
                "have_count": len(have_rows),
                "have_names": [display_name(r, blind_mode) for r in have_rows[:6]],
                "evidence_ids": evidence_ids[:6],
            }
        )

    compact_full = [compact_row(r, blind_mode) for r in full_match[:8]]
    shown = compact_full or [compact_row(r, blind_mode) for r in source[:5]]
    return {
        "ok": True,
        "headline": f"Must-have coverage for {job.get('title') or 'this role'}",
        "must_haves": must,
        "by_skill": by_skill,
        "full_match_names": [c["display_name"] for c in compact_full],
        "candidates": shown,
    }


def _clarify(**kwargs: Any) -> dict[str, Any]:
    job: dict[str, Any] = kwargs["job"]
    title = job.get("title") or "the current role"
    return {
        "ok": False,
        "headline": "Need a more specific recruiting question",
        "candidates": [],
        "message": (
            f"I can help with **{title}**, but that question is too vague to ground in the scored pool.\n\n"
            "Try one of:\n"
            "- “Show me the top Python candidates”\n"
            "- “Who should I interview next?”\n"
            "- “Compare the selected candidates”\n"
            "- “What’s the biggest skill gap?”\n"
            "- “Who meets every must-have skill?”"
        ),
    }


def _query_tokens(text: str) -> set[str]:
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9+#.]{1,}", (text or "").lower())
    return {w for w in words if w not in _STOP}


def _skill_catalog(pool: list[dict[str, Any]], job: dict[str, Any]) -> list[str]:
    skills: list[str] = []
    seen: set[str] = set()
    for item in list(job.get("required_skills") or []) + list(job.get("nice_to_have_skills") or []):
        label = skill_label(item)
        key = normalize_skill(label)
        if label and key not in seen:
            skills.append(label)
            seen.add(key)
    for row in pool:
        for item in list(row.get("matched_skills") or []) + list(row.get("skills") or []):
            label = skill_label(item)
            key = normalize_skill(label)
            if label and key not in seen:
                skills.append(label)
                seen.add(key)
    return skills
