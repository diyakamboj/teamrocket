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

    score = round((weighted_matched / weighted_total) * 100, 2) if weighted_total else 100.0

    return {
        "keyword_score": score,
        "matched_keywords": matched,
        "missing_keywords": missing,
    }


def _semantic_prompt(candidate: Candidate, job: JobPosting) -> str:
    return f"""
You are a senior technical recruiter doing a SEMANTIC fit review — judging
whether the candidate's real experience meets the role's needs by meaning,
not by literal keyword presence. Credit synonyms, adjacent tools, and
clearly transferable experience even if the exact keyword never appears.

Job: {job.title}
Required skills: {job.required_skills}
Nice to have: {job.nice_to_have_skills}
Required experience (years): {job.required_experience_years}

Candidate resume:
{(candidate.resume_text or "")[:4000]}

Return JSON with keys:
semantic_score (integer 0-100 — overall semantic fit),
rationale (2-3 sentences explaining the score),
equivalent_terms (list of {{"resume_term": str, "jd_keyword": str}} objects —
  cases where the candidate demonstrates a required/nice-to-have skill using
  different wording than the job description; empty list if none).
"""


def _fallback_semantic_score(baseline_score: float) -> float:
    # Degrade to the keyword baseline rather than fail the request outright
    # if the model returns something unparseable.
    return baseline_score


async def compute_semantic_score(
    candidate: Candidate, job: JobPosting, *, baseline_score: float
) -> dict[str, Any]:
    result = openai_service.chat_json(_semantic_prompt(candidate, job), temperature=0.2)

    raw_score = result.get("semantic_score")
    try:
        score = float(raw_score)
    except (TypeError, ValueError):
        score = _fallback_semantic_score(baseline_score)
    score = round(max(0.0, min(100.0, score)), 2)

    equivalent_terms = result.get("equivalent_terms")
    if not isinstance(equivalent_terms, list):
        equivalent_terms = []

    return {
        "semantic_score": score,
        "semantic_rationale": result.get("rationale") or "No rationale returned by the model.",
        "equivalent_terms": equivalent_terms,
    }


def _verdict(keyword_score: float, semantic_score: float) -> str:
    delta = semantic_score - keyword_score
    if delta >= STRONG_DELTA_THRESHOLD:
        return "semantic_stronger"
    if delta <= -STRONG_DELTA_THRESHOLD:
        return "keyword_stronger"
    return "aligned"


async def get_benchmark(candidate: Candidate, job: JobPosting) -> dict[str, Any]:
    baseline = compute_keyword_baseline(candidate, job)
    semantic = await compute_semantic_score(candidate, job, baseline_score=baseline["keyword_score"])
    delta = round(semantic["semantic_score"] - baseline["keyword_score"], 2)
    return {
        **baseline,
        **semantic,
        "score_delta": delta,
        "verdict": _verdict(baseline["keyword_score"], semantic["semantic_score"]),
    }


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
        keyword_score=Decimal(str(result["keyword_score"])),
        matched_keywords=result["matched_keywords"],
        missing_keywords=result["missing_keywords"],
        semantic_score=Decimal(str(result["semantic_score"])),
        semantic_rationale=result["semantic_rationale"],
        equivalent_terms=result["equivalent_terms"],
        score_delta=Decimal(str(result["score_delta"])),
        verdict=result["verdict"],
    )
    if benchmark:
        for field, value in payload.items():
            setattr(benchmark, field, value)
    else:
        benchmark = AtsBenchmarkScore(evaluation_id=evaluation.id, **payload)
    store.ats_benchmarks.save(benchmark)
    return benchmark
