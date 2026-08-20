"""ATS Benchmark Baseline Scoring: dual-scoring framework.

Layer 1 — ATS keyword baseline: a deterministic, no-LLM score that mimics
how a traditional keyword-matching ATS works — scan the raw resume text for
literal occurrences of the job's required/nice-to-have keywords. This is
intentionally dumb: it doesn't understand synonyms or context, the same way
a real ATS keyword filter doesn't.

Layer 2 — LLM semantic evaluation: an LLM reads the resume and the role and
judges fit by meaning, catching cases a keyword scan misses (different
terminology for the same skill, adjacent tools, seniority context).

The two scores are reported side by side, with a rationale for why they
diverge — since the interesting signal is the *delta*, not either
number alone.
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

from app.models.ats_benchmark import AtsBenchmarkScore
from app.models.candidate import Candidate
from app.models.evaluation import Evaluation
from app.models.job_posting import JobPosting
from app.services.azure_services import openai_service
from app.storage.store import Store

# Required skills count double a nice-to-have hit, mirroring how most ATS
# keyword filters weight "must-have" vs "preferred" keyword lists.
REQUIRED_WEIGHT = 2
NICE_TO_HAVE_WEIGHT = 1
STRONG_DELTA_THRESHOLD = 15.0


def _keyword_present(keyword: str, haystack_lower: str) -> bool:
    kw = keyword.strip().lower()
    if not kw:
        return False
    pattern = r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])"
    if re.search(pattern, haystack_lower):
        return True
    return kw in haystack_lower


def compute_keyword_baseline(candidate: Candidate, job: JobPosting) -> dict[str, Any]:
    resume_lower = (candidate.resume_text or "").lower()
    required = [str(s) for s in (job.required_skills or [])]
    nice_to_have = [str(s) for s in (job.nice_to_have_skills or [])]

    matched: list[str] = []
    missing: list[str] = []
    weighted_matched = 0
    weighted_total = 0

    for keyword in required:
        weighted_total += REQUIRED_WEIGHT
        if _keyword_present(keyword, resume_lower):
            matched.append(keyword)
            weighted_matched += REQUIRED_WEIGHT
        else:
            missing.append(keyword)

    for keyword in nice_to_have:
        weighted_total += NICE_TO_HAVE_WEIGHT
        if _keyword_present(keyword, resume_lower):
            matched.append(keyword)
            weighted_matched += NICE_TO_HAVE_WEIGHT
        else:
            missing.append(keyword)

    # A job with no required or nice-to-have skills gives the keyword scan
    # nothing to look for. That is not a perfect match -- it is *no baseline*.
    # Scoring it 100 handed every candidate a flawless ATS result off zero
    # matched keywords, which is worse than useless: it looks authoritative.
    score = round((weighted_matched / weighted_total) * 100, 2) if weighted_total else None

    return {
        "keyword_score": score,
        "matched_keywords": matched,
        "missing_keywords": missing,
    }


ATS_SCORING_SYSTEM = """You are an ATS scoring engine for a hiring product.
Return valid JSON only. Produce ONE overall ATS score (0-100), not a separate
"AI fit" number. Score the résumé against the job the way a recruiter would:
skills, experience, education, certifications, and projects. Use the full
range — do not cluster every candidate around 70. Credit synonyms and
transferable experience. Be consistent and evidence-based."""


def _semantic_prompt(candidate: Candidate, job: JobPosting) -> str:
    return f"""
Score this candidate with a proper ATS score against the role.

Job: {job.title}
Required skills: {job.required_skills}
Nice to have: {job.nice_to_have_skills}
Required experience (years): {job.required_experience_years}
Education: {job.education_requirements}

Candidate resume:
{(candidate.resume_text or "")[:4000]}

Return JSON with keys:
ats_score (integer 0-100 — the single overall ATS score),
semantic_score (same integer as ats_score, for compatibility),
category_scores (object with integer 0-100 values for skills, experience,
  education, certifications, projects),
tier (one of: poor, average, good, excellent —
  poor <50, average 50-64, good 65-79, excellent 80+),
rationale (2-3 sentences explaining the ATS score),
equivalent_terms (list of {{"resume_term": str, "jd_keyword": str}} objects —
  cases where the candidate demonstrates a required/nice-to-have skill using
  different wording than the job description; empty list if none).
"""


async def compute_semantic_score(candidate: Candidate, job: JobPosting) -> dict[str, Any]:
    """The LLM's semantic read of the fit, or None if it could not produce one.

    This used to fall back to the keyword baseline when the model returned
    something unparseable, which made the delta exactly 0.00 and the verdict
    "aligned" -- reporting perfect agreement between two scores when in truth
    only one of them existed. A missing score now stays missing.
    """
    result = openai_service.chat_json_or_empty(
        _semantic_prompt(candidate, job),
        system=ATS_SCORING_SYSTEM,
        temperature=0.2,
    )

    try:
        raw = result.get("ats_score", result.get("semantic_score"))
        score = round(max(0.0, min(100.0, float(raw))), 2)
    except (TypeError, ValueError):
        score = None

    equivalent_terms = result.get("equivalent_terms")
    if not isinstance(equivalent_terms, list):
        equivalent_terms = []

    return {
        "semantic_score": score,
        "semantic_rationale": (
            result.get("rationale")
            or ("No rationale returned by the model." if score is not None else None)
        ),
        "equivalent_terms": equivalent_terms,
    }


def _verdict(keyword_score: float | None, semantic_score: float | None) -> str:
    """Comparing the two scores only means something when both exist."""
    if keyword_score is None:
        return "no_keyword_baseline"
    if semantic_score is None:
        return "semantic_unavailable"
    delta = semantic_score - keyword_score
    if delta >= STRONG_DELTA_THRESHOLD:
        return "semantic_stronger"
    if delta <= -STRONG_DELTA_THRESHOLD:
        return "keyword_stronger"
    return "aligned"


async def get_benchmark(candidate: Candidate, job: JobPosting) -> dict[str, Any]:
    baseline = compute_keyword_baseline(candidate, job)
    semantic = await compute_semantic_score(candidate, job)

    # The delta is the difference between two scores; with one missing there
    # is no difference to report, and 0.0 would read as "they agree".
    if baseline["keyword_score"] is None or semantic["semantic_score"] is None:
        delta = None
    else:
        delta = round(semantic["semantic_score"] - baseline["keyword_score"], 2)

    return {
        **baseline,
        **semantic,
        "score_delta": delta,
        "verdict": _verdict(baseline["keyword_score"], semantic["semantic_score"]),
    }


def _as_decimal(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def upsert_benchmark(
    store: Store,
    evaluation: Evaluation,
    candidate: Candidate,
    job: JobPosting,
    result: dict[str, Any],
) -> AtsBenchmarkScore:
    benchmark = store.ats_benchmarks.get_for_evaluation(evaluation.id)
    payload = dict(
        candidate_id=candidate.id,
        job_id=job.id,
        keyword_score=_as_decimal(result["keyword_score"]),
        matched_keywords=result["matched_keywords"],
        missing_keywords=result["missing_keywords"],
        semantic_score=_as_decimal(result["semantic_score"]),
        semantic_rationale=result["semantic_rationale"],
        equivalent_terms=result["equivalent_terms"],
        score_delta=_as_decimal(result["score_delta"]),
        verdict=result["verdict"],
    )
    if benchmark:
        for field, value in payload.items():
            setattr(benchmark, field, value)
    else:
        benchmark = AtsBenchmarkScore(evaluation_id=evaluation.id, **payload)
    store.ats_benchmarks.save(benchmark)
    return benchmark
