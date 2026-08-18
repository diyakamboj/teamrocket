"""Three-signal scoring helpers ported from parsing-feature."""

from __future__ import annotations

import math
import re
from typing import Any, Optional

from app.services.azure_services import openai_service

OUT_OF_CATEGORY_WEIGHT = 0.5


def matches_keyword(haystack: str, keyword: str) -> bool:
    escaped = re.escape(keyword)
    return bool(
        re.search(rf"(^|[^a-z0-9+#.]){escaped}([^a-z0-9+#.]|$)", haystack, flags=re.IGNORECASE)
    )


def keyword_signal(
    keywords: list[str],
    category_text: str,
    all_text: str,
) -> dict[str, Any]:
    if not keywords:
        return {"score": 0.0, "matched": [], "missing": []}
    matched: list[str] = []
    missing: list[str] = []
    weighted = 0.0
    best = 0.0
    for keyword in keywords:
        weight = (
            1.0
            if matches_keyword(category_text, keyword)
            else OUT_OF_CATEGORY_WEIGHT
            if matches_keyword(all_text, keyword)
            else 0.0
        )
        if weight > 0:
            matched.append(keyword)
        else:
            missing.append(keyword)
        weighted += weight
        best = max(best, weight)
    coverage = weighted / len(keywords)
    score = 0.0 if best == 0 else min(100.0, round(40 * best + coverage * 60, 2))
    return {"score": score, "matched": matched, "missing": missing}


def normalize_similarity(cosine: float) -> float:
    return max(0.0, min(100.0, round(((cosine - 0.15) / 0.4) * 100, 2)))


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def semantic_signal(requirement_text: str, category_text: str) -> Optional[float]:
    vectors = openai_service.embed_texts([requirement_text, category_text])
    if not vectors or len(vectors) < 2:
        return None
    return normalize_similarity(cosine_similarity(vectors[0], vectors[1]))


def blend_signals(keyword_score: float, semantic_score: Optional[float], ai_score: Optional[float]) -> float:
    if ai_score is not None and semantic_score is not None:
        return round(keyword_score * 0.3 + semantic_score * 0.2 + ai_score * 0.5, 2)
    if semantic_score is not None:
        return round(keyword_score * 0.6 + semantic_score * 0.4, 2)
    return round(keyword_score, 2)
