"""Question plan for a Level 1 screening, built for one specific candidate.

The plan is never a fixed questionnaire: which competencies get asked, and
what each question is about, comes from this candidate's own matched skills,
missing required skills, experience entries and projects. A candidate who
already evidences Kubernetes gets a depth probe on it; one who doesn't gets
an honest exposure question about the gap.

Each question carries the criteria a strong answer must hit (used later by
the rubric) and the citation explaining why it was asked — the resume
evidence or job requirement behind it.

The model is asked first when one is configured; its output is validated and
merged over a deterministic plan, so screening still works — and still adapts
— in mock mode or when the model returns something unusable.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable, Mapping, Optional

from app.services.azure_services import openai_service
from app.services.screening_context import ScreeningContext
from app.utils.logger import get_logger
from app.utils.validators import normalize_skill

logger = get_logger(__name__)

DEFAULT_QUESTION_COUNT = 6
MIN_QUESTION_COUNT = 3
MAX_QUESTION_COUNT = 10

#: competency -> (category shown to the recruiter, weight in the scorecard)
COMPETENCIES: dict[str, tuple[str, float]] = {
    "technical_depth": ("technical", 1.2),
    "technical_gap": ("technical", 1.0),
    "problem_solving": ("problem_solving", 1.1),
    "behavioral": ("behavioral", 1.0),
    "communication": ("communication", 0.9),
    "role_fit": ("role_fit", 0.8),
}

#: Signals a good answer contains, per competency, on top of topic keywords.
BASE_SIGNALS: dict[str, list[str]] = {
    "technical_depth": ["design", "trade-off", "production", "scale", "debug"],
    "technical_gap": ["learn", "similar", "exposure", "documentation", "ramp"],
    "problem_solving": ["approach", "measure", "root cause", "constraint", "iterate"],
    "behavioral": ["team", "stakeholder", "outcome", "conflict", "ownership"],
    "communication": ["explain", "audience", "example", "clarify", "summary"],
    "role_fit": ["notice", "available", "interested", "expectation", "location"],
}


@dataclass
class ScreeningQuestion:
    id: str
    order: int
    competency: str
    category: str
    question: str
    criteria: list[str]
    signals: list[str]
    weight: float
    rationale: str
    citations: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _citation(source: str, label: str, detail: str) -> dict[str, Any]:
    return {"source": source, "label": label, "detail": detail}


def _requirement_citation(context: ScreeningContext, skill: str) -> dict[str, Any]:
    return _citation(
        "job_requirement",
        f"{context.job_title} · required skill",
        f"{skill} is listed in the job requirements",
    )


def _resume_citation(context: ScreeningContext, skill: str) -> Optional[dict[str, Any]]:
    evidence = context.evidence_for_skill(skill)
    if evidence and evidence.detail:
        return _citation("resume", evidence.label, evidence.detail)
    return None


def _dedupe(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        key = normalize_skill(str(value))
        if key and key not in seen:
            seen.add(key)
            out.append(str(value).strip())
    return out


def _recent_role(context: ScreeningContext) -> Optional[Mapping[str, Any]]:
    for item in context.experience:
        if item.get("title") or item.get("company"):
            return item
    return None


def _project_label(context: ScreeningContext) -> Optional[str]:
    for item in context.projects:
        name = str(item.get("name") or "").strip()
        if name:
            return name
    return None


def _technical_depth_question(context: ScreeningContext, skill: str) -> tuple[str, list[str]]:
    citations = [_requirement_citation(context, skill)]
    resume = _resume_citation(context, skill)
    if resume:
        citations.append(resume)
        question = (
            f"Your resume points to {skill} work — \"{resume['detail'][:110]}\". "
            f"Walk me through what you personally built there, and the hardest "
            f"{skill} problem you had to solve."
        )
    else:
        question = (
            f"You list {skill} among your skills. Describe the most substantial thing "
            f"you have built with it, and one trade-off you had to make."
        )
    return question, citations


def _technical_gap_question(context: ScreeningContext, skill: str) -> tuple[str, list[str]]:
    nearest = next(
        (s for s in context.skills if normalize_skill(s) != normalize_skill(skill)), None
    )
    bridge = f" Your {nearest} experience may be relevant — say so if it is." if nearest else ""
    question = (
        f"{skill} is required for this role but we did not find it in your profile. "
        f"What exposure do you have, and how would you get productive with it?{bridge}"
    )
    return question, [
        _requirement_citation(context, skill),
        _citation(
            "evaluation",
            "Screening gap",
            f"{skill} was not matched against the candidate's profile",
        ),
    ]


def _problem_solving_question(context: ScreeningContext) -> tuple[str, list[str]]:
    focus = (
        context.matched_skills[0]
        if context.matched_skills
        else (context.required_skills[0] if context.required_skills else "the stack")
    )
    question = (
        f"A {focus} service in production starts failing intermittently for about 5% of "
        f"requests, with no recent deploy. Talk me through how you would investigate, "
        f"and how you would decide it is fixed."
    )
    return question, [
        _citation(
            "job_requirement",
            f"{context.job_title} · day-to-day work",
            f"Role centres on {focus}; production troubleshooting is part of the job",
        )
    ]


def _behavioral_question(context: ScreeningContext) -> tuple[str, list[str]]:
    role = _recent_role(context)
    project = _project_label(context)
    if role:
        where = " at ".join(
            p for p in [str(role.get("title") or "").strip(), str(role.get("company") or "").strip()] if p
        )
        question = (
            f"Thinking about your time as {where or 'in your most recent role'} — tell me about a "
            f"time you disagreed with a teammate or stakeholder on a technical decision. "
            f"What did you do, and how did it end?"
        )
        citation = _citation(
            "resume",
            "Experience",
            f"{where}: {str(role.get('description') or '').strip()[:120]}".strip(": "),
        )
    elif project:
        question = (
            f"Tell me about the {project} project — what was your role, who else was involved, "
            f"and what would you do differently now?"
        )
        citation = _citation("resume", "Projects", f"Project on the candidate's profile: {project}")
    else:
        question = (
            "Tell me about a project you owned end-to-end. What was your role, and what went "
            "wrong along the way?"
        )
        citation = _citation(
            "evaluation", "Profile", "No detailed experience entries were available to anchor on"
        )
    return question, [citation]


def _communication_question(context: ScreeningContext) -> tuple[str, list[str]]:
    topic = (
        context.matched_skills[0]
        if context.matched_skills
        else (context.skills[0] if context.skills else "your current work")
    )
    question = (
        f"Explain {topic} to a non-technical stakeholder who needs to approve budget for it. "
        f"Keep it to what they would actually care about."
    )
    return question, [
        _citation(
            "job_requirement",
            f"{context.job_title} · communication",
            "Level 1 screening assesses whether the candidate can explain their work to non-specialists",
        )
    ]


def _role_fit_question(context: ScreeningContext) -> tuple[str, list[str]]:
    years = context.required_experience_years
    expectation = (
        f" The role expects around {years} years of relevant experience." if years else ""
    )
    question = (
        f"What is drawing you to a {context.job_title} role right now, and what is your notice "
        f"period or earliest start date?{expectation}"
    )
    return question, [
        _citation(
            "job_requirement",
            f"{context.job_title} · logistics",
            "Availability and motivation are confirmed at Level 1 before interview slots are booked",
        )
    ]


def _plan_slots(context: ScreeningContext, count: int) -> list[tuple[str, str, list[str]]]:
    """Choose which competencies to ask, in order, adapted to the candidate.

    Returns (competency, topic, extra_signals) tuples. Depth probes come from
    matched skills, gap probes from unmatched required skills, and the mix
    shifts with how much of the requirement list the candidate already covers.
    """
    matched = _dedupe(context.matched_skills or context.skills)
    missing = _dedupe(context.missing_skills)

    slots: list[tuple[str, str, list[str]]] = []
    if matched:
        slots.append(("technical_depth", matched[0], [matched[0]]))
    if missing:
        slots.append(("technical_gap", missing[0], [missing[0]]))
    slots.append(("problem_solving", "", []))
    slots.append(("behavioral", "", []))
    slots.append(("communication", matched[0] if matched else "", []))

    # Remaining budget goes to whichever side of the profile is thinner:
    # more gaps to probe, or more claimed strengths to verify.
    extras: list[tuple[str, str, list[str]]] = []
    for skill in missing[1:]:
        extras.append(("technical_gap", skill, [skill]))
    for skill in matched[1:]:
        extras.append(("technical_depth", skill, [skill]))
    if len(missing) <= 1:
        extras.insert(0, ("role_fit", "", []))
    else:
        extras.append(("role_fit", "", []))

    slots.extend(extras)
    return slots[:count]


def _build_question(
    context: ScreeningContext,
    competency: str,
    topic: str,
    extra_signals: list[str],
    order: int,
) -> ScreeningQuestion:
    if competency == "technical_depth":
        text, citations = _technical_depth_question(context, topic)
        criteria = [
            f"Describes concrete {topic} work they did themselves",
            "Names a specific technical trade-off or failure and its resolution",
            "Gives verifiable specifics (scale, tooling, outcome)",
        ]
    elif competency == "technical_gap":
        text, citations = _technical_gap_question(context, topic)
        criteria = [
            f"States their actual level of {topic} exposure without overclaiming",
            "Connects adjacent experience or a concrete ramp-up plan",
        ]
    elif competency == "problem_solving":
        text, citations = _problem_solving_question(context)
        criteria = [
            "Structured investigation rather than guesswork",
            "Uses signals/data (logs, metrics, traces) to narrow the cause",
            "Defines how they would confirm the fix",
        ]
    elif competency == "behavioral":
        text, citations = _behavioral_question(context)
        criteria = [
            "Concrete situation with their own role in it",
            "Shows how they handled the other party",
            "States the outcome and what they learned",
        ]
    elif competency == "communication":
        text, citations = _communication_question(context)
        criteria = [
            "Plain language, no unexplained jargon",
            "Framed around what the stakeholder cares about",
            "Structured and concise",
        ]
    else:
        text, citations = _role_fit_question(context)
        criteria = [
            "Clear, specific motivation for this role",
            "States notice period or start date",
        ]

    category, weight = COMPETENCIES[competency]
    signals = _dedupe([*extra_signals, *BASE_SIGNALS[competency]])
    rationale = _rationale(context, competency, topic)
    return ScreeningQuestion(
        id=f"q{order}",
        order=order,
        competency=competency,
        category=category,
        question=text,
        criteria=criteria,
        signals=signals,
        weight=weight,
        rationale=rationale,
        citations=citations,
    )


def _rationale(context: ScreeningContext, competency: str, topic: str) -> str:
    if competency == "technical_depth":
        return f"{topic} is claimed and required — verify the claim is real before interview time is spent."
    if competency == "technical_gap":
        return f"{topic} is required but unmatched on this profile — size the gap now."
    if competency == "problem_solving":
        return "Level 1 checks structured debugging, which the resume cannot show."
    if competency == "behavioral":
        return "Checks ownership and how the candidate handles disagreement."
    if competency == "communication":
        return "Checks whether technical depth survives contact with a non-technical audience."
    return f"Confirms motivation and availability for {context.job_title}."


def _merge_model_questions(
    plan: list[ScreeningQuestion],
    model_questions: list[Mapping[str, Any]],
) -> list[ScreeningQuestion]:
    """Take the model's wording where it is usable, keep our scaffolding.

    Competency, weights, citations and ordering stay deterministic; only the
    question text and criteria can come from the model, and only when they
    are non-empty strings.
    """
    for question, raw in zip(plan, model_questions):
        text = str(raw.get("question") or "").strip()
        if len(text) >= 20:
            question.question = text
        criteria = [str(c).strip() for c in (raw.get("criteria") or []) if str(c).strip()]
        if criteria:
            question.criteria = criteria[:5]
        signals = [str(s).strip() for s in (raw.get("signals") or []) if str(s).strip()]
        if signals:
            question.signals = _dedupe([*question.signals, *signals])[:10]
    return plan


def _model_questions(context: ScreeningContext, plan: list[ScreeningQuestion]) -> list[Mapping[str, Any]]:
    prompt = f"""
Write Level 1 phone-screen questions for one specific candidate.

Role: {context.job_title}
Required skills: {context.required_skills}
Nice to have: {context.nice_to_have_skills}
Years required: {context.required_experience_years}

Candidate: {context.candidate_name} — {context.title or "unknown title"}, {context.years_experience} years
Skills: {context.skills}
Matched required skills: {context.matched_skills}
Missing required skills: {context.missing_skills}
Known strengths: {context.strengths}
Known gaps: {context.gaps}
Recent experience: {context.experience[:3]}

Produce one question per slot below, in order, keeping each slot's competency and topic:
{[{"slot": q.order, "competency": q.competency, "about": q.rationale} for q in plan]}

Return JSON: {{"questions": [{{"question": str, "criteria": [str], "signals": [str]}}]}}
Questions must reference this candidate's actual background, not generic phrasing.
""".strip()

    try:
        result = openai_service.chat_json(prompt, temperature=0.4)
    except Exception as exc:  # model unavailable — deterministic plan still stands
        logger.warning("Screening question generation via model failed: %s", exc)
        return []

    questions = result.get("questions")
    if not isinstance(questions, list):
        return []
    return [q for q in questions if isinstance(q, Mapping)]


def generate_plan(
    context: ScreeningContext,
    *,
    question_count: int = DEFAULT_QUESTION_COUNT,
    use_model: bool = True,
) -> list[ScreeningQuestion]:
    count = max(MIN_QUESTION_COUNT, min(MAX_QUESTION_COUNT, question_count))
    plan = [
        _build_question(context, competency, topic, signals, order)
        for order, (competency, topic, signals) in enumerate(_plan_slots(context, count), start=1)
    ]
    if use_model:
        model_questions = _model_questions(context, plan)
        if model_questions:
            plan = _merge_model_questions(plan, model_questions)
    return plan
