"""JD Optimizer & Calibration Analysis Service.

Classifies each JD requirement against the job-scoped evaluated candidate pool:
- too_strict / low_signal / under_filtered / balanced / insufficient_data
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from app.models.jd_recommendation import JDRecommendationRecord
from app.models.job_posting import JobPosting
from app.services.analytics_scope import job_evaluated_population
from app.services.azure_services import openai_service
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError, ValidationAppError
from app.utils.validators import has_normalized_skill, normalize_skill, normalized_skill_set, skill_text


STRICT_THRESHOLD = 25.0
LENIENT_THRESHOLD = 85.0
MIN_POOL_SIZE = 10
LOW_SCORE_CUTOFF = 55.0

CLASSIFICATION_SUGGESTIONS = {
    "too_strict": "Move to nice-to-have",
    "low_signal": "Keep listed, but it is not differentiating the pool",
    "under_filtered": "Consider promoting to MUST-have",
    "balanced": "No change recommended",
    "insufficient_data": "Collect more evaluations before changing the JD",
}


class JDOptimizerService:
    def _ordered_requirements(self, job: JobPosting) -> list[tuple[str, bool]]:
        ordered: list[tuple[str, bool]] = []
        seen: set[str] = set()
        for raw, is_must in (
            *[(skill, True) for skill in (job.required_skills or [])],
            *[(skill, False) for skill in (job.nice_to_have_skills or [])],
        ):
            skill = skill_text(raw)
            key = normalize_skill(skill)
            if not key or key in seen:
                continue
            seen.add(key)
            ordered.append((skill, is_must))
        return ordered

    def _classify(
        self,
        *,
        skill: str,
        is_must_have: bool,
        candidates_matching: int,
        total_candidates: int,
        low_score_without: int,
    ) -> dict[str, Any]:
        coverage_pct = (
            round((candidates_matching / total_candidates) * 100, 2) if total_candidates else 0.0
        )
        low_score_without_skill_pct = (
            round((low_score_without / total_candidates) * 100, 2) if total_candidates else 0.0
        )

        if total_candidates < MIN_POOL_SIZE:
            classification = "insufficient_data"
        elif is_must_have and coverage_pct < STRICT_THRESHOLD:
            classification = "too_strict"
        elif is_must_have and coverage_pct > LENIENT_THRESHOLD:
            classification = "low_signal"
        elif not is_must_have and coverage_pct < STRICT_THRESHOLD:
            classification = "under_filtered"
        else:
            classification = "balanced"

        supporting_data = {
            "population": "job-scoped evaluated candidates",
            "is_must_have": is_must_have,
            "coverage_pct": coverage_pct,
            "candidates_matching": candidates_matching,
            "candidates_missing": max(total_candidates - candidates_matching, 0),
            "total_candidates": total_candidates,
            "low_score_without_skill": low_score_without,
            "low_score_without_skill_pct": low_score_without_skill_pct,
            "low_score_cutoff": LOW_SCORE_CUTOFF,
            "strict_threshold": STRICT_THRESHOLD,
            "lenient_threshold": LENIENT_THRESHOLD,
            "min_pool_size": MIN_POOL_SIZE,
        }

        return {
            "skill": skill,
            "is_must_have": is_must_have,
            "coverage_pct": coverage_pct,
            "candidates_matching": candidates_matching,
            "total_candidates": total_candidates,
            "classification": classification,
            "suggested_modification": CLASSIFICATION_SUGGESTIONS[classification],
            "supporting_data": supporting_data,
        }

    def _heuristic_summary(self, job_title: str, items: list[dict[str, Any]]) -> str:
        if not items:
            return f"No JD calibration signals yet for '{job_title}'."
        ranked = sorted(
            items,
            key=lambda item: (
                0
                if item["classification"] == "too_strict"
                else 1
                if item["classification"] == "under_filtered"
                else 2
                if item["classification"] == "low_signal"
                else 3
                if item["classification"] == "insufficient_data"
                else 4,
                item["coverage_pct"],
            ),
        )
        top = ranked[0]
        if top["classification"] == "too_strict":
            return (
                f"{top['coverage_pct']:.0f}% of otherwise-screened candidates have {top['skill']}, "
                "which is marked MUST-have — consider downgrading it to nice-to-have."
            )
        if top["classification"] == "under_filtered":
            return (
                f"Only {top['coverage_pct']:.0f}% of candidates show {top['skill']}, currently a "
                "nice-to-have. Promoting it to MUST-have would sharpen ranking."
            )
        if top["classification"] == "low_signal":
            return (
                f"{top['coverage_pct']:.0f}% of candidates already have {top['skill']}, so the "
                "MUST-have is not filtering the pool."
            )
        if top["classification"] == "insufficient_data":
            return (
                f"Only {top['total_candidates']} evaluated candidates for '{job_title}'. "
                "Raw counts are shown until the pool reaches 10."
            )
        return f"Required skills for '{job_title}' look balanced against the evaluated pool."

    def _serialize(self, record: JDRecommendationRecord, live: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": record.id,
            "skill": live["skill"],
            "is_must_have": live["is_must_have"],
            "coverage_pct": live["coverage_pct"],
            "candidates_matching": live["candidates_matching"],
            "total_candidates": live["total_candidates"],
            "classification": live["classification"],
            "suggested_modification": live["suggested_modification"],
            "supporting_data": live["supporting_data"],
            "status": record.status or "pending",
            "recruiter_note": record.recruiter_note,
        }

    def _empty_response(self, job: JobPosting, summary: str, empty_reason: str) -> dict[str, Any]:
        return {
            "job_id": job.id,
            "job_title": job.title,
            "recommendations": [],
            "summary": summary,
            "generated_at": datetime.now(timezone.utc).replace(tzinfo=None),
            "empty_reason": empty_reason,
        }

    def _compute_live(self, job: JobPosting, evaluations, candidates_by_id) -> list[dict[str, Any]]:
        total = len(evaluations)
        items: list[dict[str, Any]] = []
        for skill, is_must_have in self._ordered_requirements(job):
            matching = 0
            low_without = 0
            for evaluation in evaluations:
                candidate = candidates_by_id.get(evaluation.candidate_id)
                if not candidate:
                    continue
                if has_normalized_skill(skill, normalized_skill_set(candidate.skills)):
                    matching += 1
                    continue
                score = float(evaluation.overall_score) if evaluation.overall_score is not None else 0.0
                if score < LOW_SCORE_CUTOFF:
                    low_without += 1
            items.append(
                self._classify(
                    skill=skill,
                    is_must_have=is_must_have,
                    candidates_matching=matching,
                    total_candidates=total,
                    low_score_without=low_without,
                )
            )
        return items

    def _upsert_records(
        self,
        store: Store,
        job_id: UUID,
        live_items: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        existing_rows = store.jd_recommendations.query(lambda rec: str(rec.job_id) == str(job_id))
        existing = {record.skill_key: record for record in existing_rows}
        serialized: list[dict[str, Any]] = []
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for item in live_items:
            key = normalize_skill(item["skill"])
            record = existing.get(key)
            if record is None:
                record = JDRecommendationRecord(
                    job_id=job_id,
                    skill=item["skill"],
                    skill_key=key,
                    classification=item["classification"],
                    status="pending",
                    suggested_modification=item["suggested_modification"],
                    supporting_data=item["supporting_data"],
                )
            else:
                record.skill = item["skill"]
                record.classification = item["classification"]
                record.suggested_modification = item["suggested_modification"]
                record.supporting_data = item["supporting_data"]
                record.updated_at = now
            store.jd_recommendations.save(record)
            serialized.append(self._serialize(record, item))
        return serialized

    async def get_optimization(
        self,
        store: Store,
        job_id: UUID,
        *,
        include_summary: bool = True,
    ) -> dict[str, Any]:
        job = store.jobs.get(job_id)
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

        requirements = self._ordered_requirements(job)
        if not requirements:
            return self._empty_response(
                job,
                "Visit Job Description Analysis first to extract requirements.",
                "no_required_skills",
            )

        evaluations, _candidates, candidates_by_id = job_evaluated_population(store, job_id)
        if not evaluations:
            return self._empty_response(
                job,
                "Run some candidates through screening to see recommendations.",
                "no_evaluations",
            )

        live_items = self._compute_live(job, evaluations, candidates_by_id)
        recommendations = self._upsert_records(store, job_id, live_items)

        summary = ""
        if include_summary:
            try:
                prompt = f"""
Write a short recruiter-facing paragraph about JD calibration for role '{job.title}'.
Use these structured signals:
{recommendations[:5]}

Keep it under 80 words. Cite the coverage percentages. Do not invent skills.
"""
                summary = openai_service.chat_text(prompt, temperature=0.4, max_tokens=220)
            except Exception:
                summary = ""
            if not summary or "ranked candidate pool" in summary.lower():
                summary = self._heuristic_summary(job.title, live_items)

        return {
            "job_id": job_id,
            "job_title": job.title,
            "recommendations": recommendations,
            "summary": summary,
            "generated_at": datetime.now(timezone.utc).replace(tzinfo=None),
            "empty_reason": None,
        }

    def record_decision(
        self,
        store: Store,
        job_id: UUID,
        recommendation_id: UUID,
        *,
        status: str,
        note: Optional[str],
        recruiter_email: str,
    ) -> dict[str, Any]:
        if status not in {"accepted", "rejected", "modified"}:
            raise ValidationAppError("Invalid decision status", {"status": status})

        job = store.jobs.get(job_id)
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

        record = store.jd_recommendations.get(recommendation_id)
        if not record or str(record.job_id) != str(job_id):
            raise NotFoundError(
                "Recommendation not found",
                {"recommendation_id": str(recommendation_id), "job_id": str(job_id)},
            )

        record.status = status
        record.recruiter_note = note
        record.decided_at = datetime.now(timezone.utc).replace(tzinfo=None)
        record.decided_by = recruiter_email
        store.jd_recommendations.save(record)

        data = record.supporting_data or {}
        matching = int(data.get("candidates_matching") or 0)
        total = int(data.get("total_candidates") or 0)
        live = {
            "skill": record.skill,
            "is_must_have": bool(data.get("is_must_have", True)),
            "coverage_pct": float(data.get("coverage_pct") or 0),
            "candidates_matching": matching,
            "total_candidates": total,
            "classification": record.classification,
            "suggested_modification": record.suggested_modification or "",
            "supporting_data": data,
        }
        return self._serialize(record, live)


jd_optimizer = JDOptimizerService()
