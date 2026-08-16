"""The handover document: what the next interviewer needs to know.

Built from the screening transcript plus the context the session started
from, so every line traces to something — a resume snippet, a job
requirement, or a specific screening answer. Sections map to what an
interviewer actually reads before a call: who this is, how the screen went,
what to trust, what to worry about, and what to ask next.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

from app.services.azure_services import openai_service
from app.services.screening_context import ScreeningContext
from app.services.screening_evaluator import ADEQUATE_THRESHOLD, STRONG_THRESHOLD
from app.utils.logger import get_logger

logger = get_logger(__name__)

CATEGORY_LABELS = {
    "technical": "Technical",
    "problem_solving": "Problem solving",
    "behavioral": "Behavioural",
    "communication": "Communication",
    "role_fit": "Role fit & availability",
}

#: How each competency reads as an interview agenda item.
AREA_LABELS = {
    "technical_depth": "Technical depth",
    "technical_gap": "Unproven required skill",
    "problem_solving": "Problem solving",
    "behavioral": "Behavioural signal",
    "communication": "Communication",
    "role_fit": "Role fit & availability",
}

VERDICT_LABELS = {
    "advance": "Recommendation: advance to interview.",
    "advance_with_reservations": "Recommendation: advance, with reservations.",
    "hold": "Recommendation: hold — do not book interview time yet.",
    "incomplete": "Recommendation: none — the screen produced no answers.",
}


def _competency_label(turn: Mapping[str, Any]) -> str:
    """Human wording for a competency mid-sentence, naming the skill if known."""
    competency = str(turn.get("competency") or "screening")
    topic = _turn_topic(turn)
    if topic and competency == "technical_depth":
        return f"{topic} depth"
    if topic and competency == "technical_gap":
        return f"{topic} exposure"
    return AREA_LABELS.get(competency, competency.replace("_", " ")).lower()


def _turn_topic(turn: Mapping[str, Any]) -> Optional[str]:
    """The skill a question was about, read back off its requirement citation."""
    for citation in turn.get("citations") or []:
        if isinstance(citation, Mapping) and citation.get("source") == "job_requirement":
            detail = str(citation.get("detail") or "")
            if " is listed in the job requirements" in detail:
                return detail.split(" is listed")[0].strip()
    return None


def _background(context: ScreeningContext) -> dict[str, Any]:
    return {
        "name": context.candidate_name,
        "title": context.title,
        "years_experience": context.years_experience,
        "education": context.education,
        "certifications": context.certifications,
        "skills": context.skills,
        "applying_for": context.job_title,
        "match_score": context.overall_score,
        "matched_requirements": context.matched_skills,
        "unmatched_requirements": context.missing_skills,
    }


def _screening_performance(scorecard: Mapping[str, Any]) -> dict[str, Any]:
    categories = scorecard.get("categories") or {}
    return {
        "overall_score": scorecard.get("overall_score", 0.0),
        "recommendation": scorecard.get("recommendation", "incomplete"),
        "recommendation_reason": scorecard.get("recommendation_reason", ""),
        "questions_answered": scorecard.get("answered", 0),
        "by_category": [
            {
                "category": name,
                "label": CATEGORY_LABELS.get(name, name.replace("_", " ").title()),
                "score": bucket.get("score", 0.0),
                "rating": bucket.get("rating", "weak"),
                "questions": bucket.get("questions", 0),
            }
            for name, bucket in sorted(
                categories.items(), key=lambda kv: -float(kv[1].get("score") or 0.0)
            )
        ],
    }


def _turn_citation(turn: Mapping[str, Any]) -> dict[str, Any]:
    evaluation = turn.get("evaluation") or {}
    citations = evaluation.get("citations") or []
    if citations:
        return dict(citations[0])
    return {
        "source": "screening",
        "label": f"Answer to {turn.get('question_id', 'question')}",
        "detail": str(turn.get("answer") or "")[:150],
    }


def _strengths(
    context: ScreeningContext,
    turns: list[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for turn in turns:
        evaluation = turn.get("evaluation") or {}
        if float(evaluation.get("score") or 0) < STRONG_THRESHOLD:
            continue
        matched = evaluation.get("matched_signals") or []
        items.append(
            {
                "point": (
                    f"Answered the {_competency_label(turn)} question well "
                    f"({float(evaluation.get('score') or 0):.0f}/100)"
                    + (f", covering {', '.join(matched[:3])}" if matched else "")
                ),
                "citations": [_turn_citation(turn)],
            }
        )

    for strength in context.strengths[:2]:
        items.append(
            {
                "point": f"Profile strength: {strength}",
                "citations": [
                    {
                        "source": "evaluation",
                        "label": "Existing evaluation",
                        "detail": strength,
                    }
                ],
            }
        )
    return items[:6]


def _weaknesses(
    context: ScreeningContext,
    turns: list[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for turn in turns:
        evaluation = turn.get("evaluation")
        # A question that was never answered is a coverage gap, not a
        # weakness — it is reported under concerns instead.
        if not evaluation:
            continue
        score = float(evaluation.get("score") or 0)
        if score >= ADEQUATE_THRESHOLD:
            continue
        missing = evaluation.get("missing_signals") or []
        items.append(
            {
                "point": (
                    f"Weak on {_competency_label(turn)} ({score:.0f}/100)"
                    + (f" — did not address {', '.join(missing[:3])}" if missing else "")
                ),
                "citations": [_turn_citation(turn)],
            }
        )

    for gap in context.gaps[:2]:
        items.append(
            {
                "point": f"Profile gap: {gap}",
                "citations": [
                    {"source": "evaluation", "label": "Existing evaluation", "detail": gap}
                ],
            }
        )
    return items[:6]


def _concerns(
    context: ScreeningContext,
    turns: list[Mapping[str, Any]],
    scorecard: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """Things that should change how the interview is run, not just scores."""
    concerns: list[dict[str, Any]] = []

    unanswered = [t for t in turns if not t.get("evaluation")]
    if unanswered:
        concerns.append(
            {
                "point": f"{len(unanswered)} screening question(s) went unanswered.",
                "citations": [
                    {
                        "source": "screening",
                        "label": "Incomplete screening",
                        "detail": f"Unanswered: {', '.join(str(t.get('question_id')) for t in unanswered)}",
                    }
                ],
            }
        )

    for turn in turns:
        evaluation = turn.get("evaluation") or {}
        if "No substantive answer" in " ".join(evaluation.get("notes") or []):
            concerns.append(
                {
                    "point": (
                        f"Declined to answer the {turn.get('competency', 'screening')} question — "
                        f"re-test this directly in the interview."
                    ),
                    "citations": [_turn_citation(turn)],
                }
            )

    # A candidate who reads well but cannot evidence depth is the expensive
    # false positive an L1 screen exists to catch, so it is called out.
    categories = scorecard.get("categories") or {}
    communication = float((categories.get("communication") or {}).get("score") or 0)
    technical = float((categories.get("technical") or {}).get("score") or 0)
    if communication >= STRONG_THRESHOLD and technical and technical < ADEQUATE_THRESHOLD:
        concerns.append(
            {
                "point": (
                    "Presents well but technical answers did not hold up — weight the interview "
                    "toward hands-on depth rather than discussion."
                ),
                "citations": [
                    {
                        "source": "screening",
                        "label": "Scorecard",
                        "detail": f"Communication {communication:.0f}/100 vs technical {technical:.0f}/100",
                    }
                ],
            }
        )

    if context.required_experience_years and context.years_experience:
        shortfall = context.required_experience_years - context.years_experience
        if shortfall >= 2:
            concerns.append(
                {
                    "point": (
                        f"{context.years_experience:.0f} years against {context.required_experience_years} "
                        f"required — probe scope of ownership, not just tenure."
                    ),
                    "citations": [
                        {
                            "source": "job_requirement",
                            "label": f"{context.job_title} · experience",
                            "detail": f"Role expects {context.required_experience_years} years",
                        }
                    ],
                }
            )

    return concerns[:6]


def _skill_gaps(
    context: ScreeningContext,
    turns: list[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Required skills still unproven after the screen, with what we learned."""
    gaps: list[dict[str, Any]] = []
    for skill in context.missing_skills:
        related = next(
            (
                t
                for t in turns
                if t.get("competency") == "technical_gap"
                and skill.lower() in str(t.get("question") or "").lower()
            ),
            None,
        )
        if related and related.get("evaluation"):
            evaluation = related["evaluation"]
            gaps.append(
                {
                    "skill": skill,
                    "status": "probed",
                    "finding": (
                        f"Screened on it and scored {float(evaluation.get('score') or 0):.0f}/100 "
                        f"({evaluation.get('rating')})."
                    ),
                    "citations": [_turn_citation(related)],
                }
            )
        else:
            gaps.append(
                {
                    "skill": skill,
                    "status": "unprobed",
                    "finding": "Required by the role, not evidenced on the profile, not covered in screening.",
                    "citations": [
                        {
                            "source": "job_requirement",
                            "label": f"{context.job_title} · required skill",
                            "detail": f"{skill} is listed in the job requirements",
                        }
                    ],
                }
            )
    return gaps


def _recommended_areas(
    context: ScreeningContext,
    turns: list[Mapping[str, Any]],
    scorecard: Mapping[str, Any],
) -> list[dict[str, Any]]:
    areas: list[dict[str, Any]] = []

    for turn in sorted(
        (t for t in turns if t.get("evaluation")),
        key=lambda t: float(t["evaluation"].get("score") or 0),
    )[:2]:
        evaluation = turn["evaluation"]
        missing = evaluation.get("missing_signals") or []
        competency = str(turn.get("competency") or "screening")
        topic = _turn_topic(turn)
        areas.append(
            {
                "area": (
                    f"{topic} — {AREA_LABELS.get(competency, competency)}"
                    if topic
                    else AREA_LABELS.get(competency, competency.replace("_", " ").title())
                ),
                "why": (
                    f"Weakest screening answer at {float(evaluation.get('score') or 0):.0f}/100"
                    + (f"; never addressed {', '.join(missing[:3])}" if missing else "")
                ),
                "suggested_question": _followup_question(turn, context),
                "citations": [_turn_citation(turn)],
            }
        )

    for gap in _skill_gaps(context, turns):
        if gap["status"] == "unprobed":
            areas.append(
                {
                    "area": f"{gap['skill']} depth",
                    "why": gap["finding"],
                    "suggested_question": (
                        f"Have you used {gap['skill']} in production? If not, what is the closest "
                        f"thing you have shipped?"
                    ),
                    "citations": gap["citations"],
                }
            )

    if scorecard.get("recommendation") == "advance" and not areas:
        areas.append(
            {
                "area": "Depth verification",
                "why": "Screened cleanly across the board — use the interview for depth, not re-screening.",
                "suggested_question": (
                    f"Design a {context.job_title.lower()} component end-to-end and defend the trade-offs."
                ),
                "citations": [
                    {
                        "source": "screening",
                        "label": "Scorecard",
                        "detail": str(scorecard.get("recommendation_reason") or ""),
                    }
                ],
            }
        )

    return areas[:6]


def _followup_question(turn: Mapping[str, Any], context: ScreeningContext) -> str:
    competency = str(turn.get("competency") or "")
    evaluation = turn.get("evaluation") or {}
    missing = evaluation.get("missing_signals") or []
    if competency == "technical_depth":
        return (
            "Take the same system and go one level deeper: what would you change if traffic "
            "grew 10x, and what breaks first?"
        )
    if competency == "technical_gap":
        topic = _turn_topic(turn) or "the missing skill"
        return (
            f"Pair-program a small {topic} task — the screen did not establish working knowledge."
        )
    if competency == "problem_solving":
        return "Give them a live incident scenario and ask for the first three things they check."
    if competency == "behavioral":
        return "Ask for a second example with a worse outcome, and what they would do differently."
    if competency == "communication":
        return f"Have them whiteboard {context.matched_skills[0] if context.matched_skills else 'their last project'} for a mixed audience."
    if missing:
        return f"Revisit {missing[0]} directly — the screening answer skipped it."
    return "Re-test this area with a concrete, hands-on task."


def _model_summary(
    context: ScreeningContext,
    turns: list[Mapping[str, Any]],
    scorecard: Mapping[str, Any],
) -> Optional[str]:
    transcript = [
        {
            "question": t.get("question"),
            "answer": str(t.get("answer") or "")[:600],
            "score": (t.get("evaluation") or {}).get("score"),
        }
        for t in turns
    ]
    prompt = f"""
Write a 3-4 sentence pre-interview summary for the interviewer.

Candidate: {context.candidate_name} for {context.job_title}
Existing match score: {context.overall_score}
Screening result: {scorecard.get("overall_score")}/100 — {scorecard.get("recommendation")}
Strong areas: {scorecard.get("strong_areas")} · Weak areas: {scorecard.get("weak_areas")}
Unmatched requirements: {context.missing_skills}

Transcript:
{transcript}

Be specific and blunt. State what the screen proved and what it did not.
Return JSON: {{"summary": str}}
""".strip()

    try:
        result = openai_service.chat_json(prompt, temperature=0.3)
    except Exception as exc:
        logger.warning("Screening briefing summary via model failed: %s", exc)
        return None

    summary = str(result.get("summary") or "").strip()
    return summary if len(summary) >= 40 else None


def _fallback_summary(
    context: ScreeningContext,
    scorecard: Mapping[str, Any],
    skill_gaps: list[dict[str, Any]],
) -> str:
    strong = scorecard.get("strong_areas") or []
    weak = scorecard.get("weak_areas") or []
    unprobed = [g["skill"] for g in skill_gaps if g["status"] == "unprobed"]

    answered = int(scorecard.get("answered", 0) or 0)
    parts = [
        f"{context.candidate_name} screened {scorecard.get('overall_score', 0):.0f}/100 for "
        f"{context.job_title} across {answered} question{'' if answered == 1 else 's'}."
    ]
    if strong:
        parts.append(f"Held up on {', '.join(CATEGORY_LABELS.get(s, s) for s in strong).lower()}.")
    if weak:
        parts.append(f"Did not hold up on {', '.join(CATEGORY_LABELS.get(w, w) for w in weak).lower()}.")
    if unprobed:
        parts.append(f"Still unproven: {', '.join(unprobed)}.")
    parts.append(
        VERDICT_LABELS.get(
            str(scorecard.get("recommendation") or ""),
            str(scorecard.get("recommendation_reason") or ""),
        )
    )
    return " ".join(p for p in parts if p).strip()


def build_briefing(
    context: ScreeningContext,
    turns: list[Mapping[str, Any]],
    scorecard: Mapping[str, Any],
    *,
    use_model: bool = True,
) -> dict[str, Any]:
    skill_gaps = _skill_gaps(context, turns)
    summary = (_model_summary(context, turns, scorecard) if use_model else None) or _fallback_summary(
        context, scorecard, skill_gaps
    )

    return {
        "summary": summary,
        "background": _background(context),
        "screening_performance": _screening_performance(scorecard),
        "strengths": _strengths(context, turns),
        "weaknesses": _weaknesses(context, turns),
        "concerns": _concerns(context, turns, scorecard),
        "skill_gaps": skill_gaps,
        "recommended_areas": _recommended_areas(context, turns, scorecard),
        "transcript": [
            {
                "question_id": t.get("question_id"),
                "competency": t.get("competency"),
                "question": t.get("question"),
                "answer": t.get("answer"),
                "score": (t.get("evaluation") or {}).get("score"),
                "rating": (t.get("evaluation") or {}).get("rating"),
            }
            for t in turns
        ],
    }
