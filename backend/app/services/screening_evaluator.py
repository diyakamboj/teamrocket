"""Scoring for screening answers.

Every answer is scored on three measurable axes and combined with weights
that depend on what the question was testing — a communication question
weights clarity, a technical depth probe weights coverage:

  coverage      how many of the question's expected signals the answer hits
  depth         concrete specifics: numbers, named tools, causal reasoning
  clarity       structure and readability of the answer itself

The scoring is deterministic so the same answer always scores the same and
the recruiter can be shown exactly which signals were hit and missed. When a
model is configured it may adjust the score within a bounded range and add a
note; it can never invent the evidence, and a model outage changes nothing.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Mapping, Optional

from app.services.azure_services import openai_service
from app.services.screening_questions import COMPETENCIES
from app.utils.logger import get_logger
from app.utils.validators import normalize_skill

logger = get_logger(__name__)

STRONG_THRESHOLD = 72.0
ADEQUATE_THRESHOLD = 48.0

#: An answer shorter than this cannot evidence anything.
MIN_SUBSTANTIVE_WORDS = 12

#: How far the model is allowed to move a deterministic score, in points.
MODEL_ADJUSTMENT_LIMIT = 12.0

#: axis weights per competency — (coverage, depth, clarity)
AXIS_WEIGHTS: dict[str, tuple[float, float, float]] = {
    "technical_depth": (0.45, 0.40, 0.15),
    "technical_gap": (0.45, 0.30, 0.25),
    "problem_solving": (0.40, 0.40, 0.20),
    "behavioral": (0.35, 0.35, 0.30),
    "communication": (0.25, 0.20, 0.55),
    "role_fit": (0.50, 0.20, 0.30),
}

NON_ANSWER_PATTERNS = (
    r"^\s*(i\s+)?(don'?t|do not)\s+know\b",
    r"^\s*no\s+(idea|experience|comment)\b",
    r"^\s*(n/?a|none|nothing|skip|pass)\s*[.!]?\s*$",
)

DEPTH_MARKERS = (
    "because",
    "so that",
    "which meant",
    "we measured",
    "i decided",
    "the reason",
    "trade-off",
    "tradeoff",
    "instead of",
    "root cause",
)

FILLER_WORDS = ("basically", "stuff", "things", "kind of", "sort of", "you know", "etc")


@dataclass
class AnswerEvaluation:
    score: float
    rating: str  # "strong" | "adequate" | "weak"
    coverage: float
    depth: float
    clarity: float
    matched_signals: list[str] = field(default_factory=list)
    missing_signals: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    citations: list[dict[str, Any]] = field(default_factory=list)
    scored_by: str = "rubric"  # "rubric" | "rubric+model"

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[A-Za-z0-9+#./-]+", text) if w]


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"[.!?]+", text) if s.strip()]


def _is_non_answer(text: str) -> bool:
    lowered = text.strip().lower()
    if not lowered:
        return True
    return any(re.search(pattern, lowered) for pattern in NON_ANSWER_PATTERNS)


def _signal_hits(answer: str, signals: list[str]) -> tuple[list[str], list[str]]:
    normalized = normalize_skill(answer)
    matched: list[str] = []
    missing: list[str] = []
    for signal in signals:
        key = normalize_skill(signal)
        if key and key in normalized:
            matched.append(signal)
        else:
            missing.append(signal)
    return matched, missing


def _coverage_score(matched: list[str], signals: list[str]) -> float:
    if not signals:
        return 60.0
    # Hitting roughly half the signals is already a solid answer; the curve
    # rewards the first few hits rather than demanding every keyword.
    ratio = len(matched) / len(signals)
    return round(min(100.0, ratio * 160.0), 2)


def _depth_score(answer: str) -> float:
    words = _words(answer)
    if not words:
        return 0.0
    length_component = min(60.0, len(words) / 90 * 60.0)
    lowered = answer.lower()
    marker_hits = sum(1 for marker in DEPTH_MARKERS if marker in lowered)
    numbers = len(re.findall(r"\b\d+(?:[.,]\d+)?\s*(?:%|ms|s|k|m|x|gb|tb|qps|rps)?\b", lowered))
    specifics = min(25.0, marker_hits * 8.0)
    quantified = min(15.0, numbers * 5.0)
    return round(min(100.0, length_component + specifics + quantified), 2)


def _clarity_score(answer: str) -> float:
    sentences = _sentences(answer)
    words = _words(answer)
    if not sentences or not words:
        return 0.0

    average_length = len(words) / len(sentences)
    # 8–24 words per sentence reads well; drift in either direction costs.
    if average_length < 8:
        length_penalty = (8 - average_length) * 3.0
    elif average_length > 24:
        length_penalty = (average_length - 24) * 2.5
    else:
        length_penalty = 0.0

    lowered = answer.lower()
    filler_penalty = min(20.0, sum(lowered.count(f) for f in FILLER_WORDS) * 5.0)
    structure_bonus = 10.0 if len(sentences) >= 3 else 0.0
    return round(max(0.0, min(100.0, 85.0 + structure_bonus - length_penalty - filler_penalty)), 2)


def _rating(score: float) -> str:
    if score >= STRONG_THRESHOLD:
        return "strong"
    if score >= ADEQUATE_THRESHOLD:
        return "adequate"
    return "weak"


def _excerpt(answer: str, signal: Optional[str] = None) -> str:
    """A quotable slice of the answer — around the signal when there is one."""
    text = " ".join(answer.split())
    if signal:
        position = text.lower().find(signal.lower())
        if position >= 0:
            start = max(0, position - 60)
            return text[start : position + len(signal) + 90].strip()
    return text[:150].strip()


def _model_adjustment(
    question: Mapping[str, Any],
    answer: str,
    evaluation: AnswerEvaluation,
) -> Optional[tuple[float, str]]:
    prompt = f"""
Grade one screening answer. Be strict and terse.

Question ({question.get("competency")}): {question.get("question")}
A strong answer must: {question.get("criteria")}

Candidate answer:
\"\"\"{answer[:1500]}\"\"\"

A deterministic rubric scored this {evaluation.score}/100
(signal coverage {evaluation.coverage}, depth {evaluation.depth}, clarity {evaluation.clarity}).

Return JSON: {{"score": 0-100, "note": "one sentence justifying the score"}}
""".strip()

    try:
        result = openai_service.chat_json(prompt, temperature=0.2)
    except Exception as exc:
        logger.warning("Screening answer grading via model failed: %s", exc)
        return None

    raw_score = result.get("score")
    if not isinstance(raw_score, (int, float)):
        return None
    note = str(result.get("note") or "").strip()
    return float(raw_score), note


def evaluate_answer(
    question: Mapping[str, Any],
    answer: str,
    *,
    use_model: bool = True,
) -> AnswerEvaluation:
    answer = (answer or "").strip()
    competency = str(question.get("competency") or "behavioral")
    signals = [str(s) for s in (question.get("signals") or [])]

    if _is_non_answer(answer) or len(_words(answer)) < MIN_SUBSTANTIVE_WORDS:
        matched, missing = _signal_hits(answer, signals)
        return AnswerEvaluation(
            score=round(min(25.0, len(_words(answer)) * 1.5), 2),
            rating="weak",
            coverage=0.0,
            depth=0.0,
            clarity=0.0,
            matched_signals=matched,
            missing_signals=missing,
            notes=[
                "No substantive answer given — nothing here can be counted as evidence."
                if _is_non_answer(answer)
                else "Answer too short to evidence the competency."
            ],
            citations=[
                {
                    "source": "screening",
                    "label": f"Answer to {question.get('id', 'question')}",
                    "detail": _excerpt(answer) or "(no answer)",
                }
            ],
        )

    matched, missing = _signal_hits(answer, signals)
    coverage = _coverage_score(matched, signals)
    depth = _depth_score(answer)
    clarity = _clarity_score(answer)

    w_coverage, w_depth, w_clarity = AXIS_WEIGHTS.get(competency, (0.4, 0.35, 0.25))
    score = round(coverage * w_coverage + depth * w_depth + clarity * w_clarity, 2)

    notes: list[str] = []
    if matched:
        notes.append(f"Covered {', '.join(matched[:4])}.")
    if missing:
        notes.append(f"Did not address {', '.join(missing[:4])}.")
    if depth < 40:
        notes.append("Stayed general — little concrete detail or reasoning.")
    if clarity < 55:
        notes.append("Delivery was hard to follow.")

    citations = [
        {
            "source": "screening",
            "label": f"Answer to {question.get('id', 'question')}",
            "detail": _excerpt(answer, matched[0] if matched else None),
        }
    ]
    for citation in question.get("citations") or []:
        if isinstance(citation, Mapping):
            citations.append(dict(citation))

    evaluation = AnswerEvaluation(
        score=score,
        rating=_rating(score),
        coverage=coverage,
        depth=depth,
        clarity=clarity,
        matched_signals=matched,
        missing_signals=missing,
        notes=notes,
        citations=citations,
    )

    if use_model:
        adjustment = _model_adjustment(question, answer, evaluation)
        if adjustment:
            model_score, note = adjustment
            bounded = max(
                evaluation.score - MODEL_ADJUSTMENT_LIMIT,
                min(evaluation.score + MODEL_ADJUSTMENT_LIMIT, model_score),
            )
            evaluation.score = round(max(0.0, min(100.0, bounded)), 2)
            evaluation.rating = _rating(evaluation.score)
            evaluation.scored_by = "rubric+model"
            if note:
                evaluation.notes.append(note)

    return evaluation


def build_scorecard(turns: list[Mapping[str, Any]]) -> dict[str, Any]:
    """Aggregate answered turns into per-category scores and a recommendation."""
    answered = [t for t in turns if t.get("evaluation")]
    if not answered:
        return {
            "overall_score": 0.0,
            "answered": 0,
            "categories": {},
            "recommendation": "incomplete",
            "recommendation_reason": "No answers recorded yet.",
            "strong_areas": [],
            "weak_areas": [],
        }

    categories: dict[str, dict[str, Any]] = {}
    weighted_total = 0.0
    weight_total = 0.0

    for turn in answered:
        evaluation = turn["evaluation"]
        competency = str(turn.get("competency") or "behavioral")
        category, default_weight = COMPETENCIES.get(competency, ("behavioral", 1.0))
        weight = float(turn.get("weight") or default_weight)
        score = float(evaluation.get("score") or 0.0)

        bucket = categories.setdefault(
            category, {"score": 0.0, "weight": 0.0, "questions": 0, "competencies": []}
        )
        bucket["score"] += score * weight
        bucket["weight"] += weight
        bucket["questions"] += 1
        if competency not in bucket["competencies"]:
            bucket["competencies"].append(competency)

        weighted_total += score * weight
        weight_total += weight

    for bucket in categories.values():
        bucket["score"] = round(bucket["score"] / bucket["weight"], 2) if bucket["weight"] else 0.0
        bucket["rating"] = _rating(bucket["score"])
        bucket.pop("weight")

    overall = round(weighted_total / weight_total, 2) if weight_total else 0.0
    strong = sorted(
        (name for name, b in categories.items() if b["score"] >= STRONG_THRESHOLD),
        key=lambda n: -categories[n]["score"],
    )
    weak = sorted(
        (name for name, b in categories.items() if b["score"] < ADEQUATE_THRESHOLD),
        key=lambda n: categories[n]["score"],
    )

    if overall >= STRONG_THRESHOLD and not weak:
        recommendation = "advance"
        reason = f"Screened {overall:.0f}/100 with no category below the bar."
    elif overall >= ADEQUATE_THRESHOLD:
        recommendation = "advance_with_reservations"
        reason = (
            f"Screened {overall:.0f}/100"
            + (f"; weak on {', '.join(weak)}." if weak else "; no standout weakness.")
        )
    else:
        recommendation = "hold"
        reason = (
            f"Screened {overall:.0f}/100"
            + (f"; below the bar on {', '.join(weak)}." if weak else " overall.")
        )

    return {
        "overall_score": overall,
        "answered": len(answered),
        "categories": categories,
        "recommendation": recommendation,
        "recommendation_reason": reason,
        "strong_areas": strong,
        "weak_areas": weak,
    }
