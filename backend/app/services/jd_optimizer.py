"""JD Optimizer & Calibration Analysis Service.

Analyzes JD requirement coverage across candidate pool to classify requirements:
- too_strict: Extremely low match rate on required skills
- low_signal: High match rate on required skills (doesn't differentiate candidate pool)
- under_filtered: High skill relevance but currently only nice-to-have
- balanced: Filtering pool as expected
"""

from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any, Optional
import uuid

from app.models.candidate import Candidate
from app.services.azure_services import openai_service
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError
from app.utils.validators import normalize_skill

STRICT_THRESHOLD = 25.0
LENIENT_THRESHOLD = 85.0
MIN_POOL_SIZE = 5


class JDOptimizerService:
    def _skill_text(self, value: Any) -> str:
        if isinstance(value, dict):
            return str(
                value.get("skill")
                or value.get("skill_name")
                or value.get("name")
                or value.get("label")
                or ""
            ).strip()
        return str(value).strip()

    def _skill_set(self, candidate: Candidate) -> set[str]:
        return {
            normalize_skill(skill_text)
            for skill_text in (self._skill_text(skill) for skill in (candidate.skills or []))
            if skill_text
        }

    def _skill_tokens(self, requirement: str) -> list[str]:
        parts = re.split(r"\s+or\s+|\s+and\s+|/|,|\||;|\(|\)", requirement, flags=re.I)
        tokens = [normalize_skill(part) for part in parts if normalize_skill(part)]
        if not tokens:
            tokens = [normalize_skill(requirement)]
        return list(dict.fromkeys(tokens))

    def _matches_requirement(self, requirement: str, candidate_skills: set[str]) -> bool:
        requirement_norm = normalize_skill(requirement)
        if not requirement_norm:
            return False

        tokens = self._skill_tokens(requirement)
        for skill in candidate_skills:
            if not skill:
                continue
            if skill == requirement_norm or skill in requirement_norm or requirement_norm in skill:
                return True
            for token in tokens:
                if token == skill or token in skill or skill in token:
                    return True
        return False

    def _build_suggestion(
        self,
        *,
        skill: str,
        is_must_have: bool,
        candidates_matching: int,
        total_candidates: int,
    ) -> dict[str, Any]:
        coverage_pct = round((candidates_matching / total_candidates) * 100, 2) if total_candidates else 0.0

        if total_candidates < MIN_POOL_SIZE:
            classification = "insufficient_data"
            suggestion = (
                f"{candidates_matching}/{total_candidates} evaluated candidates show {skill}. "
                "The pool is too small to judge calibration confidently yet."
            )
        elif is_must_have and coverage_pct < STRICT_THRESHOLD:
            classification = "too_strict"
            suggestion = (
                f"Only {coverage_pct}% of candidates have {skill}. Consider moving it to "
                "nice-to-have or lowering the bar."
            )
        elif is_must_have and coverage_pct > LENIENT_THRESHOLD:
            classification = "low_signal"
            suggestion = (
                f"{coverage_pct}% of candidates already have {skill} — it is not narrowing your pool."
            )
        elif not is_must_have and coverage_pct < STRICT_THRESHOLD:
            classification = "under_filtered"
            suggestion = (
                f"Few candidates have {skill}, but it is currently only nice to have. "
                "If it matters, consider making it a filter to sharpen ranking."
            )
        else:
            classification = "balanced"
            suggestion = f"{skill} is filtering the pool as expected."

        return {
            "skill": skill,
            "is_must_have": is_must_have,
            "coverage_pct": coverage_pct,
            "candidates_matching": candidates_matching,
            "total_candidates": total_candidates,
            "classification": classification,
            "suggestion": suggestion,
        }

    async def get_optimization(
        self,
        store: Store,
        job_id: uuid.UUID,
        *,
        include_summary: bool = True,
    ) -> dict[str, Any]:
        job = store.jobs.get(job_id)
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

        required_skills = [
            self._skill_text(skill)
            for skill in (job.required_skills or [])
            if self._skill_text(skill)
        ]
        nice_to_have_skills = [
            self._skill_text(skill)
            for skill in (job.nice_to_have_skills or [])
            if self._skill_text(skill)
        ]

        if not required_skills and not nice_to_have_skills:
            return {
                "job_id": str(job_id),
                "job_title": job.title,
                "suggestions": [],
                "summary": "Analyze the job description first to extract requirements.",
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        evaluations = store.evaluations.list_for_job(job_id)
        if not evaluations:
            # Fallback to candidates in store
            all_candidates = store.candidates.list_all()
            if not all_candidates:
                return {
                    "job_id": str(job_id),
                    "job_title": job.title,
                    "suggestions": [],
                    "summary": "Run candidates through screening to see JD calibration suggestions.",
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }
            candidates = all_candidates
            total_candidates = len(all_candidates)
        else:
            candidates = [
                store.candidates.get(e.candidate_id)
                for e in evaluations
                if store.candidates.get(e.candidate_id)
            ]
            total_candidates = len(candidates)

        ordered_requirements: list[tuple[str, bool]] = []
        seen: set[str] = set()
        for skill in required_skills:
            key = normalize_skill(skill)
            if key and key not in seen:
                seen.add(key)
                ordered_requirements.append((skill, True))
        for skill in nice_to_have_skills:
            key = normalize_skill(skill)
            if key and key not in seen:
                seen.add(key)
                ordered_requirements.append((skill, False))

        suggestions = []
        for skill, is_must_have in ordered_requirements:
            matches = 0
            for candidate in candidates:
                if self._matches_requirement(skill, self._skill_set(candidate)):
                    matches += 1
            suggestions.append(
                self._build_suggestion(
                    skill=skill,
                    is_must_have=is_must_have,
                    candidates_matching=matches,
                    total_candidates=total_candidates,
                )
            )

        summary = ""
        if include_summary and suggestions:
            summary = (
                f"Evaluated {total_candidates} candidates against {len(suggestions)} requirements. "
                "Adjust requirements marked 'too_strict' or 'under_filtered' to calibrate candidate shortlists."
            )

        return {
            "job_id": str(job_id),
            "job_title": job.title,
            "suggestions": suggestions,
            "summary": summary,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }


jd_optimizer = JDOptimizerService()
