"""
Bounded two-step tool-using recruiter copilot (ported from parsing-feature).

1. Model picks ONE tool against the scored pool.
2. Tool runs against stored evaluations — scoring is never re-run.
3. Model synthesizes an answer citing evidence ids from tool output only.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.services.azure_services import openai_service
from app.services.copilot_pool import build_pool, job_requirements
from app.services.candidate_matcher import candidate_matcher
from app.models.schemas import WeightConfig

COPILOT_TOOLS = (
    "search_candidates",
    "get_verdicts",
    "compare",
    "gap_summary",
    "must_have_report",
)

CITES_PER_ROW = 3
MAX_ROWS = 10

TOOL_SELECT_SYSTEM = """You are a recruiting copilot. A recruiter asked a question about a scored candidate pool. Pick the ONE tool that answers it, with arguments.
Return valid JSON: {"tool": "<tool>", "args": {...}}.
Tools:
- search_candidates: args {query?, skill?, minYears?, level?} — find/rank candidates by skill, tenure, level, or free-text query.
- get_verdicts: args {candidateId} — one candidate's per-requirement verdicts and evidence. candidateId must be a label from the pool.
- compare: args {candidateIds: [<=3]} — side-by-side comparison of up to 3 candidates. Use labels from the pool.
- gap_summary: args {} — common qualification gaps across the pool.
- must_have_report: args {} — which candidates satisfy each must-have requirement.
When the question is generic (pool health, wide shortlists), prefer gap_summary or must_have_report over search_candidates."""

SYNTHESIS_SYSTEM = """You are a recruiting copilot answering a recruiter's question about a scored candidate pool. Write a concise, recruiter-friendly answer using ONLY the tool output provided. Markdown bullet lists are fine.
Never invent candidates, scores, verdicts, or quotes — everything you assert must be in the tool output. Support claims by citing evidence ids in the "evidenceIds" array, using ONLY ids shown in the tool output. If nothing in the output supports a claim, don't make it. If a candidate is labelled "Candidate #N", keep using that label and never reveal a name, file name or contact detail.
Return valid JSON: {"answer": "...", "evidenceIds": [...]}."""


class CopilotToolError(Exception):
    pass


def _to_tool_result(rows: list[dict[str, Any]]) -> dict[str, Any]:
    seen: set[str] = set()
    evidence: list[dict[str, Any]] = []
    for row in rows:
        for item in row.get("evidence") or []:
            eid = str(item.get("id", ""))
            if eid and eid not in seen:
                seen.add(eid)
                evidence.append(item)
    return {"text": json.dumps(rows), "evidence": evidence}


def _resolve_member(pool: list[dict[str, Any]], ref: str) -> dict[str, Any] | None:
    for member in pool:
        if member.get("label") == ref or str(member.get("id")) == ref:
            return member
    return None


def search_candidates(pool: list[dict[str, Any]], args: dict[str, Any]) -> dict[str, Any]:
    filtered = list(pool)
    skill = args.get("skill")
    if skill:
        needle = str(skill).lower()
        filtered = [
            c
            for c in filtered
            if any(needle in str(s).lower() for s in c.get("skills") or [])
            or any(needle in str(s).lower() for s in c.get("strengths") or [])
        ]
    min_years = args.get("minYears")
    if isinstance(min_years, (int, float)):
        filtered = [c for c in filtered if float(c.get("years") or 0) >= float(min_years)]
    level = args.get("level")
    if level:
        filtered = [c for c in filtered if str(c.get("level", "")).lower() == str(level).lower()]
    query = str(args.get("query") or "").lower()
    if query:
        for token in ("junior", "mid", "senior", "lead"):
            if token in query:
                filtered = [c for c in filtered if str(c.get("level", "")).lower() == token]
                break
        else:
            term_match = re.search(r"[a-z][a-z0-9+#.]{2,}", query)
            if term_match:
                term = term_match.group(0)
                filtered = [
                    c
                    for c in filtered
                    if any(term in str(s).lower() for s in c.get("skills") or [])
                ]
    rows = [
        {
            "label": c["label"],
            "rank": c["rank"],
            "score": c["score"],
            "years": c["years"],
            "level": c["level"],
            "skills": (c.get("skills") or [])[:12],
            "mustHaves": c.get("mustHaves"),
            "strengths": c.get("strengths"),
            "gaps": c.get("gaps"),
            "summary": c.get("summary"),
            "evidence": (c.get("evidence") or [])[:CITES_PER_ROW],
        }
        for c in filtered[:MAX_ROWS]
    ]
    return _to_tool_result(rows)


def get_verdicts(
    pool: list[dict[str, Any]],
    requirements: list[dict[str, Any]],
    args: dict[str, Any],
) -> dict[str, Any]:
    member = _resolve_member(pool, str(args.get("candidateId") or ""))
    if not member:
        raise CopilotToolError(f'Unknown candidate "{args.get("candidateId")}"')
    req_by_id = {r["id"]: r for r in requirements}
    verdict_rows = []
    for verdict in member.get("verdicts") or []:
        req = req_by_id.get(verdict.get("requirementId"))
        verdict_rows.append(
            {
                "requirement": (req or {}).get("text") or verdict.get("requirementId"),
                "category": (req or {}).get("category"),
                "must": (req or {}).get("must", False),
                "status": verdict.get("status"),
                "score": verdict.get("score"),
                "justification": verdict.get("evidence"),
                "evidenceItems": verdict.get("evidenceItems") or [],
            }
        )
    evidence = [e for row in verdict_rows for e in row.get("evidenceItems") or []]
    return {
        "text": json.dumps(
            [
                {
                    "candidate": member["label"],
                    "rank": member["rank"],
                    "score": member["score"],
                    "mustHaves": member.get("mustHaves"),
                    "summary": member.get("summary"),
                    "strengths": member.get("strengths"),
                    "gaps": member.get("gaps"),
                    "requirements": verdict_rows,
                }
            ]
        ),
        "evidence": evidence,
    }


def compare_candidates(pool: list[dict[str, Any]], args: dict[str, Any]) -> dict[str, Any]:
    ids = [str(x) for x in (args.get("candidateIds") or [])[:3]]
    members = [_resolve_member(pool, ref) for ref in ids]
    members = [m for m in members if m]
    if not members:
        raise CopilotToolError("compare needs at least one known candidate — pass labels from the pool")
    rows = [
        {
            "label": c["label"],
            "rank": c["rank"],
            "score": c["score"],
            "categories": c.get("categories"),
            "mustHaves": c.get("mustHaves"),
            "strengths": c.get("strengths"),
            "gaps": c.get("gaps"),
            "summary": c.get("summary"),
            "evidence": (c.get("evidence") or [])[:CITES_PER_ROW],
        }
        for c in members
    ]
    return _to_tool_result(rows)


def gap_summary(pool: list[dict[str, Any]], requirements: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for candidate in pool:
        for gap in candidate.get("gaps") or []:
            counts[str(gap)] = counts.get(str(gap), 0) + 1
    gap_rows = sorted(counts.items(), key=lambda x: -x[1])[:5]
    gap_payload = [
        {
            "gap": gap,
            "count": count,
            "evidence": [
                e
                for c in pool
                if gap in (c.get("gaps") or [])
                for e in (c.get("evidence") or [])[:1]
            ][:2],
        }
        for gap, count in gap_rows
    ]
    verdict_rows = []
    for req in requirements:
        met = partial = missing = 0
        for candidate in pool:
            status = next(
                (v.get("status") for v in (candidate.get("verdicts") or []) if v.get("requirementId") == req["id"]),
                "missing",
            )
            if status == "met":
                met += 1
            elif status == "partial":
                partial += 1
            else:
                missing += 1
        verdict_rows.append(
            {"requirement": req.get("text"), "must": req.get("must"), "met": met, "partial": partial, "missing": missing}
        )
    evidence = [e for row in gap_payload for e in row.get("evidence") or []]
    return {"text": json.dumps({"commonGaps": gap_payload, "requirements": verdict_rows}), "evidence": evidence}


def must_have_report(pool: list[dict[str, Any]], requirements: list[dict[str, Any]]) -> dict[str, Any]:
    musts = [r for r in requirements if r.get("must")]
    rows = []
    for req in musts:
        met = [
            c
            for c in pool
            if any(
                v.get("requirementId") == req["id"] and v.get("status") == "met"
                for v in (c.get("verdicts") or [])
            )
        ]
        rows.append(
            {
                "requirement": req.get("text"),
                "metCount": len(met),
                "candidates": [c["label"] for c in met[:5]],
                "evidence": [
                    e
                    for c in met[:3]
                    for v in (c.get("verdicts") or [])
                    if v.get("requirementId") == req["id"]
                    for e in (v.get("evidenceItems") or [])
                ],
            }
        )
    all_met = [
        c
        for c in pool
        if (c.get("mustHaves") or {}).get("total", 0) > 0
        and (c.get("mustHaves") or {}).get("met") == (c.get("mustHaves") or {}).get("total")
    ]
    evidence = [e for row in rows for e in row.get("evidence") or []]
    return {
        "text": json.dumps({"mustHaves": rows, "candidatesMeetingAll": [c["label"] for c in all_met]}),
        "evidence": evidence,
    }


def run_copilot_tool(
    tool: str,
    args: dict[str, Any],
    *,
    pool: list[dict[str, Any]],
    requirements: list[dict[str, Any]],
) -> dict[str, Any]:
    if tool == "search_candidates":
        return search_candidates(pool, args)
    if tool == "get_verdicts":
        return get_verdicts(pool, requirements, args)
    if tool == "compare":
        return compare_candidates(pool, args)
    if tool == "gap_summary":
        return gap_summary(pool, requirements)
    if tool == "must_have_report":
        return must_have_report(pool, requirements)
    raise CopilotToolError(f"Unknown copilot tool: {tool}")


def _pool_preview(pool: list[dict[str, Any]]) -> str:
    lines = []
    for c in pool[:15]:
        skills = ", ".join((c.get("skills") or [])[:8]) or "—"
        lines.append(
            f"- {c['label']} — score {c['score']}, {c['years']}y, {c['level']}; skills: {skills}"
        )
    return "\n".join(lines)


def _resolve_citations(ids: list[str], evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {str(e.get("id")): e for e in evidence if e.get("id")}
    seen: set[str] = set()
    citations: list[dict[str, Any]] = []
    for eid in ids:
        item = by_id.get(str(eid))
        if item and eid not in seen:
            seen.add(eid)
            citations.append(
                {
                    "id": item.get("id"),
                    "snippet": item.get("detail") or item.get("resume_text_snippet"),
                    "title": item.get("skill") or item.get("skill_name"),
                    "metadata": {"source": item.get("source") or item.get("source_section")},
                }
            )
    return citations


def deterministic_answer(
    question: str,
    pool: list[dict[str, Any]],
    _requirements: list[dict[str, Any]],
) -> dict[str, Any]:
    if not pool:
        return {
            "answer": "No candidates have been screened yet. Upload resumes and run screening — the copilot answers from stored verdicts only, never guesses.",
            "citations": [],
            "tools": [],
            "engine": "deterministic",
        }

    lower = question.lower()
    top = pool[:3]

    def cite(members: list[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
        return [
            {
                "id": e.get("id"),
                "snippet": e.get("detail"),
                "title": e.get("skill"),
                "metadata": {"source": e.get("source")},
            }
            for c in members[:limit]
            for e in (c.get("evidence") or [])[:1]
        ]

    if "compare" in lower or "top 3" in lower:
        answer = "Top {} by current weighting:\n\n".format(len(top)) + "\n".join(
            f"- **#{c['rank']} {c['label']}** ({c['score']}) — skills {c['categories']['skills']}, "
            f"experience {c['categories']['experience']}, education {c['categories']['education']}"
            for c in top
        )
        return {"answer": answer, "citations": cite(top), "tools": ["compare"], "engine": "deterministic"}

    if "certification" in lower:
        weak = [c for c in pool if float(c["categories"].get("certifications", 0)) < 45]
        return {
            "answer": f"{len(weak)} of {len(pool)} candidates score under 45 on certifications.",
            "citations": cite(weak),
            "tools": ["search_candidates"],
            "engine": "deterministic",
        }

    if "must" in lower or "requirement" in lower:
        full = [
            c
            for c in pool
            if (c.get("mustHaves") or {}).get("total", 0) > 0
            and (c.get("mustHaves") or {}).get("met") == (c.get("mustHaves") or {}).get("total")
        ]
        if full:
            answer = f"{len(full)} candidate{'s' if len(full) != 1 else ''} meet every must-have:\n\n" + "\n".join(
                f"- **{c['label']}** ({c['score']})" for c in full[:5]
            )
        else:
            answer = "No candidate currently meets every must-have requirement."
        return {"answer": answer, "citations": cite(full), "tools": ["must_have_report"], "engine": "deterministic"}

    if "gap" in lower:
        counts: dict[str, int] = {}
        for c in pool:
            for gap in c.get("gaps") or []:
                counts[str(gap)] = counts.get(str(gap), 0) + 1
        common = sorted(counts.items(), key=lambda x: -x[1])[:3]
        if common:
            answer = f"Most common gaps across {len(pool)} candidates:\n\n" + "\n".join(
                f"- {gap} ({n})" for gap, n in common
            )
        else:
            answer = f"No gaps were recorded for the current pool of {len(pool)} candidates."
        return {"answer": answer, "citations": [], "tools": ["gap_summary"], "engine": "deterministic"}

    for c in pool:
        first = str(c.get("label", "")).split(" ")[0].lower()
        if first != "candidate" and first and first in lower:
            answer = f"**{c['label']}** ranks #{c['rank']} with a score of {c['score']}."
            return {"answer": answer, "citations": cite([c], 1), "tools": ["get_verdicts"], "engine": "deterministic"}

    terms = re.findall(r"[a-z][a-z0-9+#.]{2,}", lower)
    for term in terms:
        with_skill = [c for c in pool if any(term in str(s).lower() for s in c.get("skills") or [])][:5]
        if with_skill:
            answer = f"{len(with_skill)} candidate(s) show {term}:\n\n" + "\n".join(
                f"- **{c['label']}** — score {c['score']}, {c['years']} yrs" for c in with_skill
            )
            return {"answer": answer, "citations": cite(with_skill), "tools": ["search_candidates"], "engine": "deterministic"}

    return {
        "answer": f"Across {len(pool)} scored candidates the highest match is **{top[0]['label']}** at {top[0]['score']}. Ask about a specific skill, candidate, must-haves or gaps.",
        "citations": cite(top[:1]),
        "tools": ["search_candidates"],
        "engine": "deterministic",
    }


def _agent_answer(question: str, pool: list[dict[str, Any]], requirements: list[dict[str, Any]]) -> dict[str, Any]:
    selection = openai_service.chat_json(
        f"Pool ({len(pool)} scored candidates):\n{_pool_preview(pool)}\n\nQuestion: {question}",
        system=TOOL_SELECT_SYSTEM,
        temperature=0,
    )
    tool = str(selection.get("tool") or "")
    if tool not in COPILOT_TOOLS:
        raise CopilotToolError("Model chose no usable tool")
    args = selection.get("args") if isinstance(selection.get("args"), dict) else {}
    result = run_copilot_tool(tool, args, pool=pool, requirements=requirements)

    answer_payload = openai_service.chat_json(
        f"Question: {question}\n\nTool output:\n{result['text']}",
        system=SYNTHESIS_SYSTEM,
        temperature=0,
    )
    answer = str(answer_payload.get("answer") or "")
    if not answer:
        raise CopilotToolError("Model answer did not validate")
    evidence_ids = answer_payload.get("evidenceIds") or []
    if not isinstance(evidence_ids, list):
        evidence_ids = []
    return {
        "answer": answer,
        "citations": _resolve_citations([str(x) for x in evidence_ids], result["evidence"]),
        "tools": [tool],
        "engine": "agent",
    }


async def copilot_answer(
    *,
    db,
    job,
    question: str,
    blind: bool = False,
    weights: WeightConfig | None = None,
) -> dict[str, Any]:
    weight_config = weights or WeightConfig()
    ranked = await candidate_matcher.rank_candidates(
        db, job.id, weight_config=weight_config, persist=False, blind_mode=blind
    )
    for item in ranked:
        item["years"] = item.get("years_of_experience")
    requirements = job_requirements(job)
    pool = build_pool(ranked, weights=weight_config, blind=blind, requirements=requirements)

    if not pool:
        return {
            "answer": "No candidates have been screened yet. Upload resumes and run screening — the copilot answers from stored verdicts only, never guesses.",
            "citations": [],
            "tools": [],
            "engine": "deterministic",
            "pool": [],
        }

    if openai_service.mock:
        result = deterministic_answer(question, pool, requirements)
        result["pool"] = pool
        return result

    try:
        result = _agent_answer(question, pool, requirements)
        result["pool"] = pool
        return result
    except Exception:
        result = deterministic_answer(question, pool, requirements)
        result["pool"] = pool
        return result
