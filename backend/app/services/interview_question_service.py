"""Generate the question bank for an interview round.

The model is asked for questions grounded in *this* job's skills and *this*
round's focus, at all three difficulties and for both audiences, with a model
answer attached to every one. A round without model answers is not much use:
the recruiter running a screen is usually not the person who could grade the
answer unaided, which is the whole reason this exists.

If the model is unreachable or returns nonsense, deterministic fallbacks are
returned and `generated_by_ai` is False, so the interface can say these are
generic rather than presenting them as tailored to the role.
"""

from __future__ import annotations

from typing import Any, Optional

from app.models.interview_questions import (
    Audience,
    Difficulty,
    InterviewQuestion,
    RoundQuestionSet,
)
from app.models.job_posting import InterviewRound, JobPosting
from app.services.azure_services import openai_service
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: Per audience, per difficulty. Enough to run a round without the
#: interviewer improvising, few enough to fit a real agenda.
QUESTIONS_PER_BUCKET = 2


SYSTEM = """You write interview questions for a hiring team.

You produce two separate sets for the same round:

NON_TECHNICAL — for a recruiter who does NOT have domain expertise. These
must be answerable and *gradable* by a non-expert: motivation, scope of past
work, how they explain something to a layperson, ways of working. Never ask
a non-technical interviewer to judge code, architecture or maths. The model
answer must let someone with no domain background tell a strong answer from
a weak one.

TECHNICAL — for an engineer or hiring manager who can evaluate depth. These
should probe real judgement and trade-offs, not trivia or definitions.

Every question needs a model answer that says what a good response actually
contains. Vague answers like "candidate should demonstrate knowledge" are
useless — be concrete about the substance you expect to hear.

Difficulty means: easy = warm-up, most competent candidates clear it;
medium = separates solid from surface-level; hard = distinguishes strong
candidates from good ones. Difficulty is about the depth demanded, not
obscurity."""


#: Reasoning deployments spend this budget on thinking as well as output, so
#: it has to comfortably cover both or the response comes back empty.
GENERATION_TOKEN_BUDGET = 8000


def _prompt(job: JobPosting, round_: InterviewRound, audience: Audience) -> str:
    return f"""
Job title: {job.title}
Required skills: {job.required_skills}
Nice to have: {job.nice_to_have_skills}
Required experience (years): {job.required_experience_years}

Job description:
{(job.description or "")[:2000]}

This round: {round_.name}
Round type: {round_.interview_type}
What this round is for: {round_.focus or "general assessment"}
Length: {round_.duration_minutes} minutes

Write questions for the {audience.value.upper()} audience only.
{QUESTIONS_PER_BUCKET} at easy, {QUESTIONS_PER_BUCKET} at medium and
{QUESTIONS_PER_BUCKET} at hard — {QUESTIONS_PER_BUCKET * 3} in total.

Return JSON: {{"questions": [
  {{"question": str,
    "difficulty": "easy"|"medium"|"hard",
    "model_answer": str,
    "signals": [str],
    "follow_ups": [str],
    "competency": str}}
]}}
""".strip()


def _coerce(raw: Any, audience: Audience) -> Optional[InterviewQuestion]:
    """One model-produced item, or None if it is not usable.

    A question without a model answer is dropped rather than shown: the
    answer is the part that makes it usable by someone who could not grade
    the question themselves.
    """
    if not isinstance(raw, dict):
        return None
    question = str(raw.get("question") or "").strip()
    answer = str(raw.get("model_answer") or "").strip()
    if not question or not answer:
        return None
    try:
        difficulty = Difficulty(str(raw.get("difficulty", "")).strip().lower())
    except ValueError:
        return None

    def _strings(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(v).strip() for v in value if str(v).strip()]

    return InterviewQuestion(
        question=question,
        difficulty=difficulty,
        audience=audience,
        model_answer=answer,
        signals=_strings(raw.get("signals")),
        follow_ups=_strings(raw.get("follow_ups")),
        competency=(str(raw.get("competency")).strip() or None)
        if raw.get("competency")
        else None,
    )


def _generate_for_audience(
    job: JobPosting, round_: InterviewRound, audience: Audience
) -> list[InterviewQuestion]:
    result = openai_service.chat_json_or_empty(
        _prompt(job, round_, audience),
        system=SYSTEM,
        temperature=0.4,
        max_tokens=GENERATION_TOKEN_BUDGET,
    )
    raw_questions = result.get("questions")
    if not isinstance(raw_questions, list):
        return []
    questions = []
    for item in raw_questions:
        parsed = _coerce(item, audience)
        if parsed is not None:
            questions.append(parsed)
    return questions


def generate_for_round(job: JobPosting, round_: InterviewRound) -> RoundQuestionSet:
    questions: list[InterviewQuestion] = []
    for audience in Audience:
        questions.extend(_generate_for_audience(job, round_, audience))

    # Both audiences must be present for the set to be usable: a recruiter
    # screen with only technical questions is worse than the generic bank.
    covered = {q.audience for q in questions}
    generated = covered == set(Audience)
    if questions and not generated:
        logger.info(
            "Only %s covered for %s / %s; using the generic bank instead",
            [a.value for a in covered], job.title, round_.name,
        )
    if not generated:
        logger.info(
            "Falling back to generic questions for %s / %s", job.title, round_.name
        )
        questions = fallback_questions(job, round_)

    return RoundQuestionSet(
        job_id=job.id,
        round_id=round_.id,
        round_name=round_.name,
        interview_type=round_.interview_type,
        questions=questions,
        generated_by_ai=generated,
    )


def fallback_questions(job: JobPosting, round_: InterviewRound) -> list[InterviewQuestion]:
    """Generic but genuinely usable questions, used when the model fails.

    Deliberately real questions with real model answers rather than
    placeholder text — an interview may be minutes away, and "could not
    generate" helps nobody standing outside a meeting room.
    """
    skill = next((str(s) for s in (job.required_skills or [])), "the core skill for this role")
    title = job.title

    return [
        InterviewQuestion(
            question=f"What drew you to this {title} role, and what are you hoping to do more of?",
            difficulty=Difficulty.EASY,
            audience=Audience.NON_TECHNICAL,
            model_answer=(
                "Specific reasons tied to this role and company rather than generic "
                "enthusiasm — the kind of work, the stage of the team, something they "
                "read about the product. Weak answers stay abstract ('great culture') "
                "or describe wanting to leave their current job rather than wanting this one."
            ),
            signals=["References something specific to this role", "Clear about what they want next"],
            follow_ups=["What would make you turn this role down?"],
            competency="Motivation",
        ),
        InterviewQuestion(
            question=(
                f"Describe a project where you used {skill}. What was your part, and what "
                "did the rest of the team do?"
            ),
            difficulty=Difficulty.MEDIUM,
            audience=Audience.NON_TECHNICAL,
            model_answer=(
                "A clear boundary between their contribution and the team's, with concrete "
                "detail about decisions they personally made. Listen for 'I' versus 'we': "
                "strong candidates are precise about their own scope and generous about "
                "others'. Vagueness about who did what is the thing to probe."
            ),
            signals=["Distinguishes own work from the team's", "Concrete about decisions they owned"],
            follow_ups=["What would you do differently now?", "Who disagreed with you, and how did that resolve?"],
            competency="Ownership",
        ),
        InterviewQuestion(
            question=(
                "Explain something technical you built to someone with no background in it. "
                "Pick anything from your recent work."
            ),
            difficulty=Difficulty.HARD,
            audience=Audience.NON_TECHNICAL,
            model_answer=(
                "They check what you already know, avoid jargon or define it as they go, and "
                "use an analogy that holds up. You should finish actually understanding what "
                "the thing does and why it mattered. This is gradable without domain "
                "knowledge precisely because you are the audience — if you are lost, that is "
                "the signal."
            ),
            signals=["Adapts to the listener", "Explains why it mattered, not only what it was"],
            follow_ups=["What was the hardest part to get right?"],
            competency="Communication",
        ),
        InterviewQuestion(
            question=f"Walk me through how you'd approach a problem in {skill} you had not seen before.",
            difficulty=Difficulty.EASY,
            audience=Audience.TECHNICAL,
            model_answer=(
                "A method rather than a memorised answer: clarify the requirements, look for "
                "the constraint that matters, try the simplest thing that could work, then "
                "measure. Strong candidates say what they would rule out and why."
            ),
            signals=["Asks clarifying questions", "Starts simple before optimising"],
            follow_ups=["What would you check first if it were slower than expected?"],
            competency=skill,
        ),
        InterviewQuestion(
            question=(
                f"Tell me about a {skill} decision you made that turned out to be wrong. "
                "How did you find out, and what did you do?"
            ),
            difficulty=Difficulty.MEDIUM,
            audience=Audience.TECHNICAL,
            model_answer=(
                "A real decision with real consequences, how it surfaced (monitoring, a "
                "user, a colleague), and what changed afterwards — ideally in their process, "
                "not just the code. Candidates who cannot name one are usually not reflecting, "
                "rather than never wrong."
            ),
            signals=["Names a specific decision", "Describes how it was detected", "Changed something durable"],
            follow_ups=["What would have caught it sooner?"],
            competency="Judgement",
        ),
        InterviewQuestion(
            question=(
                f"Where does {skill} stop being the right tool, and what would you reach for instead?"
            ),
            difficulty=Difficulty.HARD,
            audience=Audience.TECHNICAL,
            model_answer=(
                "Concrete limits from experience — scale, latency, team familiarity, "
                "operational cost — and a named alternative with its own trade-offs. The "
                "answer to listen for is a considered 'it depends, and here is on what'. "
                "Candidates who cannot criticise their main tool usually have not hit its edges."
            ),
            signals=["Names real limits, not textbook ones", "Offers an alternative with trade-offs"],
            follow_ups=["Have you actually made that switch? What did it cost?"],
            competency=skill,
        ),
    ]
