"""Candidate Aptitude & Readiness Assessment Service.

Evaluates candidate qualifications against job requirements to identify readiness/aptitude assessment needs,
manages recruiter approval workflow ("Approve & Send"), tracks notification/completion status,
and integrates completed assessment scores into candidate evaluation history.
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, List, Optional

from app.models.readiness import AssessmentRecommendation, AssessmentStatus, AssessmentType, CandidateAssessmentRecord
from app.services.candidate_matcher import candidate_matcher
from app.config import settings
from app.services.email_service import email_service
from app.services import handoff_service

from app.storage.store import Store
from app.utils.error_handlers import NotFoundError
from app.utils.logger import get_logger

logger = get_logger(__name__)


class ReadinessService:
    async def evaluate_readiness(
        self,
        store: Store,
        *,
        candidate_id: uuid.UUID,
        job_id: Optional[uuid.UUID] = None,
    ) -> AssessmentRecommendation:

        candidate = store.candidates.get(candidate_id)
        if not candidate:
            raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

        job_title = "Target Role"
        score_data: Optional[dict[str, Any]] = None
        if job_id:
            job = store.jobs.get(job_id)
            if job:
                job_title = job.title
            score_data = await candidate_matcher.get_candidate_score(store, candidate_id, job_id)

        overall = float(score_data.get("overall_score", 70.0)) if score_data else 70.0
        missing_skills = [
            str(s.get("skill") if isinstance(s, dict) else s)
            for s in (score_data.get("missing_skills") or [])
            if s
        ]

        # Determine assessment type and gap trigger
        if missing_skills:
            assessment_type: AssessmentType = "technical_depth"
            target = missing_skills[0]
            reason = (
                f"Candidate shows strong general potential ({overall:.0f}/100) but lacks verified evidence "
                f"for required competency '{target}'. A technical depth assessment will validate readiness."
            )
            triggered_by = f"Unverified required skill: {target}"
        elif overall >= 75.0:
            assessment_type = "domain_knowledge"
            target = f"System Architecture & {job_title} Alignment"
            reason = (
                f"Candidate is a high-scoring match ({overall:.0f}/100). A domain readiness evaluation "
                "will confirm advanced architectural trade-offs before senior loop interviews."
            )
            triggered_by = f"High fit ({overall:.0f}/100) candidate readiness check"
        else:
            assessment_type = "aptitude"
            target = "Core Problem Solving & Logical Reasoning"
            reason = (
                f"Candidate match score ({overall:.0f}/100) warrants foundational aptitude validation "
                "to evaluate analytical problem solving under pressure."
            )
            triggered_by = "Moderate match score threshold"

        recommendation = AssessmentRecommendation(
            candidate_id=candidate_id,
            candidate_name=candidate.name,
            job_id=job_id,
            job_title=job_title,
            assessment_type=assessment_type,
            reason=reason,
            target_competency=target,
            triggered_by_gap=triggered_by,
        )

        return recommendation

    def trigger_assessment(
        self,
        store: Store,
        *,
        candidate_id: uuid.UUID,
        job_id: Optional[uuid.UUID] = None,
        assessment_type: AssessmentType = "technical_depth",
        target_competency: str = "Technical Depth & Domain Knowledge",
        recommendation_reason: str = "Recruiter-approved assessment recommended by Recruiter Copilot",
        recruiter_email: str = "recruiter@example.com",
    ) -> CandidateAssessmentRecord:
        candidate = store.candidates.get(candidate_id)
        if not candidate:
            raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

        job_title = "Role"
        if job_id:
            job = store.jobs.get(job_id)
            if job:
                job_title = job.title

        title_map = {
            "technical_depth": f"Technical Depth Assessment: {target_competency}",
            "aptitude": f"Aptitude & Problem-Solving Evaluation: {target_competency}",
            "communication": f"Communication & Leadership Assessment: {target_competency}",
            "domain_knowledge": f"Domain Knowledge Readiness Check: {target_competency}",
        }

        record = CandidateAssessmentRecord(
            candidate_id=candidate_id,
            candidate_name=candidate.name,
            job_id=job_id,
            job_title=job_title,
            assessment_type=assessment_type,
            title=title_map.get(assessment_type, f"Readiness Assessment: {target_competency}"),
            status="sent",
            recommendation_reason=recommendation_reason,
            target_competency=target_competency,
            notification_sent=True,
            recruiter_approved=True,
            recruiter_approved_by=recruiter_email,
        )

        store.readiness_assessments.save(record)

        # Log history event for candidate
        handoff_service.log_history_event(
            store,
            candidate_id=str(candidate_id),
            event_type="assessment_triggered",
            candidate_name=candidate.name,
            job_id=str(job_id) if job_id else None,
            job_title=job_title,
            summary=f"Recruiter approved & sent {record.title} (Target: {target_competency})",
        )

        # Send the invitation and record what actually happened, so the UI can
        # say "sent" or "logged (SMTP not configured)" rather than assuming.
        result = email_service.send_assessment_invitation(
            candidate_email=candidate.email,
            candidate_name=candidate.name,
            job_title=job_title or "the role",
            assessment_title=record.title,
            target_competency=target_competency,
            assessment_url=f"{settings.ASSESSMENT_BASE_URL}/{record.id}",
        )
        record.notification_sent = result.sent
        record.notification_source = result.source
        record.notification_error = result.error
        record.assessment_url = f"{settings.ASSESSMENT_BASE_URL}/{record.id}"
        store.readiness_assessments.save(record)

        return record

    def submit_assessment_results(
        self,
        store: Store,
        *,
        assessment_id: uuid.UUID,
        score: float,
        result_summary: str,
    ) -> CandidateAssessmentRecord:
        record = store.readiness_assessments.get(assessment_id)
        if not record:
            raise NotFoundError("Assessment record not found", {"assessment_id": str(assessment_id)})

        record.score = round(max(0.0, min(100.0, score)), 1)
        record.result_summary = result_summary
        record.status = "completed" if record.score >= 70.0 else "reviewed"
        record.updated_at = datetime.now(timezone.utc)

        store.readiness_assessments.save(record)

        # Log history event
        handoff_service.log_history_event(
            store,
            candidate_id=str(record.candidate_id),
            event_type="assessment_completed",
            candidate_name=record.candidate_name,
            job_id=str(record.job_id) if record.job_id else None,
            job_title=record.job_title or "Role",
            summary=f"Completed {record.title} with score {record.score}/100. Summary: {result_summary}",
        )

        return record

    def get_candidate_assessments(
        self,
        store: Store,
        candidate_id: uuid.UUID,
    ) -> List[CandidateAssessmentRecord]:
        records = store.readiness_assessments.query(
            lambda r: r.candidate_id == candidate_id
        )
        return sorted(records, key=lambda r: r.created_at, reverse=True)


readiness_service = ReadinessService()
