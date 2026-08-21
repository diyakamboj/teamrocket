"""
Bounded two-step tool-using recruiter copilot (ported from parsing-feature).

1. Model picks ONE tool against the scored pool.
2. Tool runs against stored evaluations — scoring is never re-run.
3. Model synthesizes an answer citing evidence ids from tool output only.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from typing import Any, Callable, Optional


from app.services.azure_services import openai_service
from app.services.copilot_pool import build_pool, job_requirements, resolve_pool_member
from app.services.candidate_matcher import candidate_matcher
from app.services import calendar_service
from app.services.jd_optimizer import jd_optimizer
from app.utils.logger import get_logger
from app.models.schemas import (
    AgentCandidateCard,
    AgentComparisonTable,
    AgentEvaluationSummary,
    AgentMustHaveReport,
    AgentMustHaveRow,
    AgentRankingList,
    AgentRequirementVerdict,
    WeightConfig,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _record_agent_turn(
    status: str,
    engine: str,
    start: float,
    *,
    tool: Optional[str] = None,
    error_message: Optional[str] = None,
) -> None:
    """Records an `agent_turn` SRE event. Local import — see
    `app/services/sre_events.py`'s module docstring for why AI-adjacent
    services import it lazily rather than at module top."""
    from app.services import sre_events

    sre_events.record_event(
        event_type="agent_turn",
        service="copilot_agent",
        status=status,
        duration_ms=(time.monotonic() - start) * 1000,
        error_message=error_message,
        details={"engine": engine, "tool": tool},
    )

logger = get_logger(__name__)

COPILOT_TOOLS = (
    "search_candidates",
    "get_verdicts",
    "compare",
    "gap_summary",
    "must_have_report",
    "schedule_interview",
    "get_enriched_profile",
    "check_readiness",
    "jd_calibration",
)

ANALYTICS_QUERY_PHRASES = (
    "most common skill gaps",
    "which requirements are eliminating",
    "what percentage have",
    "what % of",
    "skill gaps",
    "drop-off",
    "drop off",
    "too strict",
    "requirement coverage",
    "jd optimization",
    "qualification gaps",
    "pipeline progression",
    "candidate source",
    "how many candidates have",
    "eliminating the most",
    "nice-to-have",
    "must-have",
)


CITES_PER_ROW = 3
MAX_ROWS = 10

TOOL_SELECT_SYSTEM = """You are an AI recruiting assistant. A recruiter asked a question about a scored candidate pool. Pick the ONE tool that answers it, with arguments.
Return valid JSON: {"tool": "<tool>", "args": {...}}.
Tools:
- search_candidates: args {query?, skill?, minYears?, level?} - find/rank candidates by skill, tenure, level, or free-text query.
- get_verdicts: args {candidateId} - one candidate's per-requirement verdicts and evidence. candidateId must be a label from the pool.
- compare: args {candidateIds: [<=3]} - side-by-side comparison of up to 3 candidates. Use labels from the pool.
- gap_summary: args {} - common qualification gaps across the pool.
- must_have_report: args {} - which candidates satisfy each must-have requirement.
- schedule_interview: args {candidateId, durationMinutes?, interviewers?: []} - schedule an interview with candidate and required interviewers.
- get_enriched_profile: args {candidateId} - view external GitHub repositories, LinkedIn, HackerRank, portfolio signals for a candidate.
- check_readiness: args {candidateId} - evaluate candidate readiness/aptitude assessment eligibility and generate transparent recommendations.
- jd_calibration: args {} - JD requirement coverage, too-strict / low-signal flags, and recruiter-reviewable calibration recommendations. Use for skill-gap %, drop-off, or "which requirements eliminate candidates".
When the question is generic (pool health, wide shortlists), prefer gap_summary or must_have_report over search_candidates. When it is about JD calibration, coverage, or eliminating requirements, pick jd_calibration."""





SYNTHESIS_SYSTEM = """You are an AI recruiting assistant answering a recruiter's question about a scored candidate pool. Write a concise, recruiter-friendly answer using ONLY the tool output provided. Markdown bullet lists are fine.
Refer to the overall number as the ATS score (not an "AI fit score"). Category scores (skills, experience, education, certifications, projects) stay separate from that overall ATS score.
Never invent candidates, scores, verdicts, or quotes — everything you assert must be in the tool output. Support claims by citing evidence ids in the "evidenceIds" array, using ONLY ids shown in the tool output. If nothing in the output supports a claim, don't make it. If a candidate is labelled "Candidate #N", keep using that label and never reveal a name, file name or contact detail.
A "Company context (recruiter-provided)" section may also be supplied, summarising documents the recruiter uploaded about their own organisation. Use it for questions about how the company works or hires, and say which document it came from. It never describes candidates: never let it change a score, verdict or claim about a person.
Return valid JSON: {"answer": "...", "evidenceIds": [...]}."""


class CopilotToolError(Exception):
    pass


def is_analytics_query(query: str) -> bool:
    """True when the recruiter is asking about JD coverage, drop-off, or calibration."""
    lower = query.lower()
    return any(phrase in lower for phrase in ANALYTICS_QUERY_PHRASES)


def format_jd_calibration_answer(optimization: dict[str, Any]) -> str:
    empty = optimization.get("empty_reason")
    if empty == "no_required_skills":
        return "Visit Job Description Analysis first to extract requirements."
    if empty == "no_evaluations":
        return "Run some candidates through screening to see recommendations."

    lines: list[str] = []
    summary = (optimization.get("summary") or "").strip()
    if summary:
        lines.append(summary)
    for item in optimization.get("recommendations") or []:
        lines.append(
            f"- {item.get('skill')}: {item.get('coverage_pct')}% "
            f"({item.get('candidates_matching')}/{item.get('total_candidates')}) "
            f"[{item.get('classification')}] — {item.get('suggested_modification')}"
        )
    return "\n".join(lines) or "No JD calibration signals yet."


async def jd_calibration_result(store, job_id) -> dict[str, Any]:
    payload = await jd_optimizer.get_optimization(store, job_id)
    return {
        "text": json.dumps(payload, default=str),
        "evidence": [],
        "structured": None,
        "optimization": payload,
    }


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


def _card(c: dict[str, Any]) -> dict[str, Any]:
    """Map a pool member to the `candidate_card` structured-payload shape."""
    summary = c.get("summary")
    if summary is not None and not isinstance(summary, str):
        summary = str(summary)
    return {
        "type": "candidate_card",
        "candidate_id": c.get("id") or None,
        "label": c.get("label"),
        "rank": c.get("rank"),
        "score": c.get("score"),
        "years": c.get("years"),
        "level": c.get("level"),
        "categories": c.get("categories") or {},
        "must_haves": c.get("mustHaves"),
        "skills": (c.get("skills") or [])[:12],
        "strengths": c.get("strengths") or [],
        "gaps": c.get("gaps") or [],
        "summary": summary,
    }


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
    matched = filtered[:MAX_ROWS]
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
        for c in matched
    ]
    result = _to_tool_result(rows)
    result["structured"] = AgentRankingList(
        candidates=[AgentCandidateCard(**_card(c)) for c in matched]
    ).model_dump(mode="json")
    return result


def get_verdicts(
    pool: list[dict[str, Any]],
    requirements: list[dict[str, Any]],
    args: dict[str, Any],
) -> dict[str, Any]:
    member = resolve_pool_member(pool, str(args.get("candidateId") or ""))
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
        "structured": AgentEvaluationSummary(
            candidate=AgentCandidateCard(**_card(member)),
            verdicts=[
                AgentRequirementVerdict(
                    requirement=row["requirement"],
                    category=row["category"],
                    must=row["must"],
                    status=row["status"],
                    score=row["score"],
                    justification=row["justification"],
                )
                for row in verdict_rows
            ],
        ).model_dump(mode="json"),
    }


def compare_candidates(pool: list[dict[str, Any]], args: dict[str, Any]) -> dict[str, Any]:
    ids = [str(x) for x in (args.get("candidateIds") or [])[:3]]
    members = [resolve_pool_member(pool, ref) for ref in ids]
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
    result = _to_tool_result(rows)
    result["structured"] = AgentComparisonTable(
        candidates=[AgentCandidateCard(**_card(c)) for c in members]
    ).model_dump(mode="json")
    return result


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
    return {
        "text": json.dumps({"commonGaps": gap_payload, "requirements": verdict_rows}),
        "evidence": evidence,
        # No natural single-candidate structured shape for a pool-wide gap
        # summary — prose-only is fine here.
        "structured": None,
    }


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
        "structured": AgentMustHaveReport(
            rows=[
                AgentMustHaveRow(
                    requirement=row["requirement"],
                    met_count=row["metCount"],
                    candidates=row["candidates"],
                )
                for row in rows
            ],
            candidates_meeting_all=[c["label"] for c in all_met],
        ).model_dump(mode="json"),
    }


def run_copilot_tool(
    tool: str,
    args: dict[str, Any],
    *,
    pool: list[dict[str, Any]],
    requirements: list[dict[str, Any]],
    jd_optimization: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if tool == "search_candidates":
        return search_candidates(pool, args)
    if tool == "get_verdicts":
        return get_verdicts(pool, requirements, args)
    if tool == "compare":
        return compare_candidates(pool, args)
    if tool == "gap_summary":
        return gap_summary(pool, requirements)
    if tool == "schedule_interview":
        cid = str(args.get("candidateId") or "")
        dur = int(args.get("durationMinutes") or 45)
        interviewers = args.get("interviewers") or []
        proposal = calendar_service.find_available_slots(pool, candidate_id=cid, duration_minutes=dur, required_interviewers=interviewers)
        return {
            "text": json.dumps({"proposalId": str(proposal.id), "slots": [s.model_dump(mode="json") for s in proposal.proposed_slots]}),
            "evidence": [],
            "structured": {
                "type": "interview_proposal",
                "proposal": proposal.model_dump(mode="json"),
            },
        }
    if tool == "get_enriched_profile":
        cid = str(args.get("candidateId") or "")
        member = resolve_pool_member(pool, cid)
        if not member:
            return {"text": json.dumps({"error": f"Candidate '{cid}' not found"}), "evidence": []}
        enriched = member.get("enriched_profile") or {}
        return {
            "text": json.dumps({
                "candidate": member["label"],
                "github_summary": enriched.get("github_summary"),
                "linkedin_summary": enriched.get("linkedin_summary"),
                "repositories": enriched.get("repositories") or [],
                "inferred_skills": enriched.get("inferred_skills") or [],
                "summary": enriched.get("summary"),
            }),
            "evidence": member.get("evidence") or [],
        }

    if tool == "check_readiness":
        cid = str(args.get("candidateId") or "")
        member = resolve_pool_member(pool, cid)
        if not member:
            return {"text": json.dumps({"error": f"Candidate '{cid}' not found"}), "evidence": []}
        score = float(member.get("score") or 70.0)
        gaps = member.get("gaps") or []
        target = gaps[0] if gaps else "Technical & Domain Competency"
        reason = f"Candidate {member['label']} matches with score {score:.0f}/100. Assessment recommended for {target}."
        return {
            "text": json.dumps({
                "candidate": member["label"],
                "assessment_type": "technical_depth",
                "target_competency": target,
                "reason": reason,
                "recommendation": "Recommended for recruiter approval and notification.",
            }),
            "evidence": member.get("evidence") or [],
        }
    if tool == "jd_calibration":
        payload = jd_optimization or {}
        return {
            "text": json.dumps(payload, default=str),
            "evidence": [],
            "structured": None,
        }
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


FOCUS_CANDIDATE_PATTERN = re.compile(
    r"\bthis candidate\b|\bthey\b|\bthem\b|\btheir\b|\bwhy (?:was|is|did)\b|\branked?\b",
    re.IGNORECASE,
)


def deterministic_answer(
    question: str,
    pool: list[dict[str, Any]],
    requirements: list[dict[str, Any]],
    focus_candidate: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not pool:
        return {
            "answer": "No candidates have been screened yet. Upload resumes and run screening — the copilot answers from stored verdicts only, never guesses.",
            "citations": [],
            "tools": [],
            "engine": "deterministic",
            "structured": None,
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

    # Natural Language Scheduling Intent Detection
    if any(k in lower for k in ("schedule", "interview", "book meeting", "calendar", "availability", "reschedule")):
        # Target candidate
        target_cand = focus_candidate or pool[0]
        for c in pool:
            c_name = str(c.get("label", "")).lower()
            if c_name and c_name != "candidate" and any(part in lower for part in c_name.split()):
                target_cand = c
                break

        # Duration
        dur_match = re.search(r"(\d+)\s*(?:min|minute)", lower)
        duration = int(dur_match.group(1)) if dur_match else 45

        # Interviewers
        known_interviewers = [
            ("alex", "Alex Chen"),
            ("priya", "Priya Sharma"),
            ("sarah", "Sarah Jenkins"),
            ("david", "David Kim"),
        ]
        interviewers = [full for kw, full in known_interviewers if kw in lower]
        if not interviewers:
            interviewers = ["Alex Chen", "Priya Sharma"]

        # Interview Type
        itype = "Technical Interview"
        if "screen" in lower or "recruiter" in lower:
            itype = "Recruiter Screen"
        elif "system design" in lower or "architecture" in lower:
            itype = "System Design Interview"
        elif "hiring manager" in lower or "final" in lower:
            itype = "Hiring Manager Interview"

        slots = calendar_service.find_available_slots(
            required_interviewers=interviewers,
            duration_minutes=duration,
            candidate_name=target_cand.get("label", "Candidate"),
            job_title="Software Role",
        )

        slots_payload = [
            {
                "slot_id": s.slot_id,
                "start_time": s.start_time.isoformat(),
                "end_time": s.end_time.isoformat(),
                "label": s.label,
                "available_interviewers": s.available_interviewers,
                "is_recommended": s.is_recommended,
                "outlook_url": s.outlook_url,
            }
            for s in slots
        ]

        structured = {
            "type": "interview_proposal",
            "proposal_id": str(uuid.uuid4()),
            "candidate_id": str(target_cand.get("id") or target_cand.get("candidate_id") or ""),
            "candidate_name": target_cand.get("label", "Candidate"),
            "job_title": "Software Role",
            "interview_type": itype,
            "duration_minutes": duration,
            "required_interviewers": interviewers,
            "proposed_slots": slots_payload,
            "notes": f"Proposed via Copilot: {question}",
        }

        inv_str = " and ".join(interviewers)
        answer = (
            f"I checked calendar availability for **{target_cand.get('label', 'Candidate')}** "
            f"and required interviewers ({inv_str}).\n\n"
            f"Here are top proposed **{duration}-minute {itype}** slots with Microsoft Teams links. "
            f"Please select and confirm your preferred time:"
        )

        return {
            "answer": answer,
            "citations": cite([target_cand], 1),
            "tools": ["schedule_interview"],
            "engine": "deterministic",
            "structured": structured,
        }

    # First priority: the recruiter is looking at a specific candidate
    # (`focus_candidate`, resolved from `AgentAskRequest.candidate_id`) and
    # the question uses a pronoun/rank reference ("this candidate", "why
    # was they ranked", ...) instead of naming anyone — resolve straight to
    # that member rather than falling through to the generic branches below.

    if focus_candidate is not None and FOCUS_CANDIDATE_PATTERN.search(lower):
        c = focus_candidate
        summary = c.get("summary")
        answer = f"**{c['label']}** ranks #{c['rank']} with a score of {c['score']}."
        if summary:
            answer += f" {summary}"
        req_by_id = {r["id"]: r for r in requirements}
        verdicts = [
            AgentRequirementVerdict(
                requirement=(req_by_id.get(v.get("requirementId")) or {}).get("text")
                or v.get("requirementId"),
                category=(req_by_id.get(v.get("requirementId")) or {}).get("category"),
                must=(req_by_id.get(v.get("requirementId")) or {}).get("must", False),
                status=v.get("status"),
                score=v.get("score"),
                justification=v.get("evidence"),
            )
            for v in (c.get("verdicts") or [])
        ]
        return {
            "answer": answer,
            "citations": cite([c], 1),
            "tools": ["get_verdicts"],
            "engine": "deterministic",
            "structured": AgentEvaluationSummary(
                candidate=AgentCandidateCard(**_card(c)),
                verdicts=verdicts,
            ).model_dump(mode="json"),
        }

    if "compare" in lower or "top 3" in lower:
        answer = "Top {} by current weighting:\n\n".format(len(top)) + "\n".join(
            f"- **#{c['rank']} {c['label']}** ({c['score']}) — skills {c['categories']['skills']}, "
            f"experience {c['categories']['experience']}, education {c['categories']['education']}"
            for c in top
        )
        return {
            "answer": answer,
            "citations": cite(top),
            "tools": ["compare"],
            "engine": "deterministic",
            "structured": AgentRankingList(
                candidates=[AgentCandidateCard(**_card(c)) for c in top]
            ).model_dump(mode="json"),
        }

    if "certification" in lower:
        weak = [c for c in pool if float(c["categories"].get("certifications", 0)) < 45]
        return {
            "answer": f"{len(weak)} of {len(pool)} candidates score under 45 on certifications.",
            "citations": cite(weak),
            "tools": ["search_candidates"],
            "engine": "deterministic",
            "structured": AgentRankingList(
                candidates=[AgentCandidateCard(**_card(c)) for c in weak]
            ).model_dump(mode="json"),
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
        return {
            "answer": answer,
            "citations": cite(full),
            "tools": ["must_have_report"],
            "engine": "deterministic",
            "structured": AgentRankingList(
                candidates=[AgentCandidateCard(**_card(c)) for c in full]
            ).model_dump(mode="json"),
        }

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
        return {
            "answer": answer,
            "citations": [],
            "tools": ["gap_summary"],
            "engine": "deterministic",
            "structured": None,
        }

    for c in pool:
        first = str(c.get("label", "")).split(" ")[0].lower()
        if first != "candidate" and first and first in lower:
            answer = f"**{c['label']}** ranks #{c['rank']} with a score of {c['score']}."
            return {
                "answer": answer,
                "citations": cite([c], 1),
                "tools": ["get_verdicts"],
                "engine": "deterministic",
                "structured": AgentCandidateCard(**_card(c)).model_dump(mode="json"),
            }

    terms = re.findall(r"[a-z][a-z0-9+#.]{2,}", lower)
    for term in terms:
        with_skill = [c for c in pool if any(term in str(s).lower() for s in c.get("skills") or [])][:5]
        if with_skill:
            answer = f"{len(with_skill)} candidate(s) show {term}:\n\n" + "\n".join(
                f"- **{c['label']}** — score {c['score']}, {c['years']} yrs" for c in with_skill
            )
            return {
                "answer": answer,
                "citations": cite(with_skill),
                "tools": ["search_candidates"],
                "engine": "deterministic",
                "structured": AgentRankingList(
                    candidates=[AgentCandidateCard(**_card(c)) for c in with_skill]
                ).model_dump(mode="json"),
            }

    return {
        "answer": f"Across {len(pool)} scored candidates the highest match is **{top[0]['label']}** at {top[0]['score']}. Ask about a specific skill, candidate, must-haves or gaps.",
        "citations": cite(top[:1]),
        "tools": ["search_candidates"],
        "engine": "deterministic",
        "structured": AgentCandidateCard(**_card(top[0])).model_dump(mode="json"),
    }


def _noop_progress(stage: str, detail: str) -> None:
    """Default when nobody is watching the agent work."""


async def _agent_answer(
    question: str,
    pool: list[dict[str, Any]],
    requirements: list[dict[str, Any]],
    *,
    model_id: str,
    deployment: str,
    focus_candidate_id: str | None = None,
    store=None,
    job=None,
    company_context: str = "",
    on_progress: Callable[[str, str], None] = _noop_progress,
) -> dict[str, Any]:
    tool_select_system = TOOL_SELECT_SYSTEM
    if focus_candidate_id:
        focus_member = resolve_pool_member(pool, focus_candidate_id)
        if focus_member:
            tool_select_system = (
                f'The recruiter is currently viewing "{focus_member["label"]}". '
                f'Resolve references like "this candidate", "them", or "they" to '
                f'"{focus_member["label"]}".\n\n' + TOOL_SELECT_SYSTEM
            )

    on_progress("plan", "Deciding how to answer")
    selection = openai_service.chat_json(
        f"Pool ({len(pool)} scored candidates):\n{_pool_preview(pool)}\n\nQuestion: {question}",
        system=tool_select_system,
        temperature=0,
        deployment=deployment,
    )
    tool = str(selection.get("tool") or "")
    if tool not in COPILOT_TOOLS:
        raise CopilotToolError("Model chose no usable tool")
    args = selection.get("args") if isinstance(selection.get("args"), dict) else {}
    jd_optimization = None
    if tool == "jd_calibration" and store is not None and job is not None:
        calibration = await jd_calibration_result(store, job.id)
        jd_optimization = calibration["optimization"]
    on_progress("tool", f"Running {tool.replace('_', ' ')}")
    result = run_copilot_tool(
        tool,
        args,
        pool=pool,
        requirements=requirements,
        jd_optimization=jd_optimization,
    )

    on_progress("answer", "Writing the answer with citations")
    # Company context is a second permitted source alongside the tool output —
    # labelled separately so the model cannot mistake it for candidate evidence.
    context_block = f"\n\nCompany context (recruiter-provided):\n{company_context}" if company_context else ""
    answer_payload = openai_service.chat_json(
        f"Question: {question}\n\nTool output:\n{result['text']}{context_block}",
        system=SYNTHESIS_SYSTEM,
        temperature=0,
        deployment=deployment,
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
        "structured": result.get("structured"),
    }


async def copilot_answer(
    *,
    db,
    job,
    question: str,
    blind: bool = False,
    weights: WeightConfig | None = None,
    model_id: str = "gpt-4o",
    deployment: str = "gpt-4o",
    focus_candidate_id: str | None = None,
    company_context: str = "",
    on_progress: Callable[[str, str], None] = _noop_progress,
) -> dict[str, Any]:
    """Answer one copilot question.

    `on_progress(stage, detail)` is called as the agent works — reading the
    pool, picking a tool, running it, writing the answer — so the UI can show
    what is actually happening instead of a spinner. It is a plain callback:
    the streaming route pushes each event onto a queue, and every other
    caller passes nothing.
    """
    weight_config = weights or WeightConfig()
    on_progress("context", f"Reading scored candidates for {job.title}")
    ranked = await candidate_matcher.rank_candidates(
        db, job.id, weight_config=weight_config, persist=False, blind_mode=blind
    )
    for item in ranked:
        item["years"] = item.get("years_of_experience")
    requirements = job_requirements(job)
    pool = build_pool(ranked, weights=weight_config, blind=blind, requirements=requirements)
    on_progress("context", f"Read {len(pool)} scored candidates against {len(requirements)} requirements")

    if is_analytics_query(question):
        on_progress("tool", "Calibrating the job description")
        calibration = await jd_calibration_result(db, job.id)
        return {
            "answer": format_jd_calibration_answer(calibration["optimization"]),
            "citations": [],
            "tools": ["jd_calibration"],
            "engine": "deterministic" if openai_service.mock else "agent",
            "pool": pool,
            "model_id": model_id,
            "structured": None,
        }

    if not pool:
        return {
            "answer": "No candidates have been screened yet. Upload resumes and run screening — the copilot answers from stored verdicts only, never guesses.",
            "citations": [],
            "tools": [],
            "engine": "deterministic",
            "pool": [],
            "model_id": model_id,
            "structured": None,
        }

    focus_candidate = resolve_pool_member(pool, focus_candidate_id) if focus_candidate_id else None
    start = time.monotonic()

    if openai_service.mock:
        on_progress("answer", "Composing the answer from stored verdicts")
        result = deterministic_answer(question, pool, requirements, focus_candidate=focus_candidate)
        result["pool"] = pool
        result["model_id"] = model_id
        _record_agent_turn(
            "success", "deterministic", start, tool=(result.get("tools") or [None])[0]
        )
        return result

    try:
        result = await _agent_answer(
            question,
            pool,
            requirements,
            model_id=model_id,
            deployment=deployment,
            focus_candidate_id=focus_candidate_id,
            store=db,
            job=job,
            company_context=company_context,
            on_progress=on_progress,
        )
        result["pool"] = pool
        result["model_id"] = model_id
        _record_agent_turn("success", "agent", start, tool=(result.get("tools") or [None])[0])
        return result
    except Exception as exc:
        logger.warning("Copilot AI path failed; using deterministic fallback: %s", exc)
        on_progress("fallback", "The model was unavailable — answering from stored verdicts")
        result = deterministic_answer(question, pool, requirements, focus_candidate=focus_candidate)
        result["pool"] = pool
        result["model_id"] = model_id
        _record_agent_turn(
            "fallback",
            "agent_failed_deterministic_fallback",
            start,
            tool=(result.get("tools") or [None])[0],
            error_message=str(exc),
        )
        return result
