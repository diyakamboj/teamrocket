"""Level 1 screening: session lifecycle and conversation state.

The conversation is a state machine persisted on every turn, not something
held in the model's context window: the plan, every answer, and every
evaluation live in `screening_sessions`, and `current_index` says which
question is outstanding. That is what stops the agent losing its place
between questions — a reconnecting client, a second browser tab, or a model
outage all resume from the same row.

On completion the results are written back onto the candidate's evaluation
as evidence (source section "L1 Screening"), so downstream interviewers see
screening findings alongside resume-derived ones.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Mapping, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.evaluation import Evaluation, Evidence
from app.models.job_posting import JobPosting
from app.models.screening import ScreeningSession
from app.services import screening_briefing, screening_questions
from app.services.evidence_tracker import SCREENING_EVIDENCE_SECTION
from app.services.screening_context import (
    ScreeningContext,
    apply_job,
    build_from_db,
    build_from_payload,
)
from app.services.screening_evaluator import build_scorecard, evaluate_answer
from app.utils.error_handlers import NotFoundError, ValidationAppError
from app.utils.logger import get_logger

logger = get_logger(__name__)

STATUS_IN_PROGRESS = "in_progress"
STATUS_COMPLETED = "completed"
STATUS_ABANDONED = "abandoned"


class ScreeningService:
    # ---------- session lifecycle ----------

    def start_session(
        self,
        db: Session,
        *,
        recruiter_email: Optional[str],
        candidate_id: Optional[UUID] = None,
        job_id: Optional[UUID] = None,
        profile: Optional[Mapping[str, Any]] = None,
        question_count: int = screening_questions.DEFAULT_QUESTION_COUNT,
        use_model: bool = True,
    ) -> ScreeningSession:
        if candidate_id is not None:
            context = build_from_db(db, candidate_id=candidate_id, job_id=job_id)
        elif profile:
            context = build_from_payload(profile)
            if job_id is not None:
                job = db.get(JobPosting, job_id)
                if not job:
                    raise NotFoundError("Job posting not found", {"job_id": str(job_id)})
                apply_job(context, job)
        else:
            raise ValidationAppError(
                "Provide either candidate_id or an inline candidate profile to screen"
            )

        plan = screening_questions.generate_plan(
            context, question_count=question_count, use_model=use_model
        )

        session = ScreeningSession(
            candidate_id=context.candidate_ref,
            candidate_name=context.candidate_name,
            job_id=context.job_id,
            job_title=context.job_title,
            evaluation_id=context.evaluation_id,
            recruiter_email=recruiter_email,
            status=STATUS_IN_PROGRESS,
            plan=[q.as_dict() for q in plan],
            turns=[],
            current_index=0,
            context=context.as_dict(),
            scorecard={},
            briefing={},
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    def get_session(self, db: Session, session_id: UUID) -> ScreeningSession:
        session = db.get(ScreeningSession, session_id)
        if not session:
            raise NotFoundError("Screening session not found", {"session_id": str(session_id)})
        return session

    def list_sessions(
        self,
        db: Session,
        *,
        recruiter_email: Optional[str] = None,
        candidate_id: Optional[str] = None,
        limit: int = 50,
    ) -> list[ScreeningSession]:
        query = db.query(ScreeningSession).order_by(ScreeningSession.created_at.desc())
        if recruiter_email:
            query = query.filter(ScreeningSession.recruiter_email == recruiter_email)
        if candidate_id:
            query = query.filter(ScreeningSession.candidate_id == candidate_id)
        return query.limit(limit).all()

    # ---------- conversation ----------

    def current_question(self, session: ScreeningSession) -> Optional[dict[str, Any]]:
        plan = list(session.plan or [])
        if session.status != STATUS_IN_PROGRESS or session.current_index >= len(plan):
            return None
        return plan[session.current_index]

    def submit_answer(
        self,
        db: Session,
        *,
        session_id: UUID,
        answer: str,
        use_model: bool = True,
    ) -> ScreeningSession:
        session = self.get_session(db, session_id)
        if session.status != STATUS_IN_PROGRESS:
            raise ValidationAppError(
                "Screening session is already closed",
                {"session_id": str(session_id), "status": session.status},
            )

        question = self.current_question(session)
        if question is None:
            # Plan exhausted but never finalized — close it out rather than
            # leaving the session stuck accepting answers to nothing.
            return self.complete_session(db, session_id=session_id, use_model=use_model)

        evaluation = evaluate_answer(question, answer, use_model=use_model)
        turns = list(session.turns or [])
        turns.append(
            {
                "question_id": question.get("id"),
                "order": question.get("order"),
                "competency": question.get("competency"),
                "category": question.get("category"),
                "weight": question.get("weight"),
                "question": question.get("question"),
                "criteria": question.get("criteria"),
                "citations": question.get("citations"),
                "answer": (answer or "").strip(),
                "answered_at": datetime.utcnow().isoformat(),
                "evaluation": evaluation.as_dict(),
            }
        )

        session.turns = turns
        session.current_index = session.current_index + 1
        session.scorecard = build_scorecard(turns)
        db.commit()
        db.refresh(session)

        if session.current_index >= len(session.plan or []):
            return self.complete_session(db, session_id=session.id, use_model=use_model)
        return session

    def skip_question(self, db: Session, *, session_id: UUID) -> ScreeningSession:
        """Move past the current question without recording an answer."""
        session = self.get_session(db, session_id)
        if session.status != STATUS_IN_PROGRESS:
            raise ValidationAppError(
                "Screening session is already closed",
                {"session_id": str(session_id), "status": session.status},
            )
        question = self.current_question(session)
        if question is None:
            return self.complete_session(db, session_id=session_id)

        turns = list(session.turns or [])
        turns.append(
            {
                "question_id": question.get("id"),
                "order": question.get("order"),
                "competency": question.get("competency"),
                "category": question.get("category"),
                "weight": question.get("weight"),
                "question": question.get("question"),
                "criteria": question.get("criteria"),
                "citations": question.get("citations"),
                "answer": None,
                "skipped": True,
                "evaluation": None,
            }
        )
        session.turns = turns
        session.current_index = session.current_index + 1
        db.commit()
        db.refresh(session)

        if session.current_index >= len(session.plan or []):
            return self.complete_session(db, session_id=session.id)
        return session

    def complete_session(
        self,
        db: Session,
        *,
        session_id: UUID,
        use_model: bool = True,
    ) -> ScreeningSession:
        session = self.get_session(db, session_id)
        if session.status == STATUS_COMPLETED:
            return session

        turns = list(session.turns or [])
        # Questions never reached are recorded as unanswered so the briefing
        # can say what was not covered instead of silently dropping them.
        for question in list(session.plan or [])[session.current_index :]:
            turns.append(
                {
                    "question_id": question.get("id"),
                    "order": question.get("order"),
                    "competency": question.get("competency"),
                    "category": question.get("category"),
                    "weight": question.get("weight"),
                    "question": question.get("question"),
                    "criteria": question.get("criteria"),
                    "citations": question.get("citations"),
                    "answer": None,
                    "evaluation": None,
                }
            )

        context = ScreeningContext(**self._context_kwargs(session))
        scorecard = build_scorecard(turns)
        briefing = screening_briefing.build_briefing(
            context, turns, scorecard, use_model=use_model
        )

        session.turns = turns
        session.current_index = len(session.plan or [])
        session.scorecard = scorecard
        session.briefing = briefing
        session.status = STATUS_COMPLETED
        session.completed_at = datetime.utcnow()

        self._write_back_evidence(db, session, turns, scorecard)
        db.commit()
        db.refresh(session)
        return session

    def abandon_session(self, db: Session, *, session_id: UUID) -> ScreeningSession:
        session = self.get_session(db, session_id)
        if session.status == STATUS_IN_PROGRESS:
            session.status = STATUS_ABANDONED
            db.commit()
            db.refresh(session)
        return session

    # ---------- feeding results back into the evaluation ----------

    def _write_back_evidence(
        self,
        db: Session,
        session: ScreeningSession,
        turns: list[Mapping[str, Any]],
        scorecard: Mapping[str, Any],
    ) -> None:
        """Attach screening findings to the candidate's evaluation.

        Only possible for sessions started from a real candidate + job, which
        is the case that has an Evaluation row to hang evidence on.
        """
        if not session.evaluation_id:
            return
        evaluation = db.get(Evaluation, session.evaluation_id)
        if not evaluation:
            logger.warning(
                "Screening evaluation row vanished before write-back: %s", session.evaluation_id
            )
            return

        # Replace evidence from an earlier screen of the same candidate/job so
        # re-screening updates the record rather than stacking duplicates.
        for row in list(evaluation.evidence_items):
            if row.source_section == SCREENING_EVIDENCE_SECTION:
                db.delete(row)

        for turn in turns:
            answer_evaluation = turn.get("evaluation")
            if not answer_evaluation:
                continue
            score = float(answer_evaluation.get("score") or 0.0)
            matched = answer_evaluation.get("matched_signals") or []
            skill_name = str(matched[0] if matched else turn.get("competency") or "screening")
            db.add(
                Evidence(
                    evaluation_id=evaluation.id,
                    skill_name=f"{skill_name} (screening)",
                    resume_text_snippet=(
                        f"Q: {turn.get('question')} — A: {str(turn.get('answer') or '')[:400]}"
                    ),
                    source_section=SCREENING_EVIDENCE_SECTION,
                    confidence_score=Decimal(str(round(score / 100, 2))),
                )
            )

        db.add(
            Evidence(
                evaluation_id=evaluation.id,
                skill_name="L1 screening result",
                resume_text_snippet=(
                    f"{scorecard.get('recommendation_reason', '')} Recommendation: "
                    f"{str(scorecard.get('recommendation') or 'n/a').replace('_', ' ')}."
                ),
                source_section=SCREENING_EVIDENCE_SECTION,
                confidence_score=Decimal(
                    str(round(float(scorecard.get("overall_score") or 0.0) / 100, 2))
                ),
            )
        )
        db.flush()

    @staticmethod
    def _context_kwargs(session: ScreeningSession) -> dict[str, Any]:
        """Rebuild the stored context dict into ScreeningContext kwargs."""
        stored = dict(session.context or {})
        stored.pop("job_id", None)
        stored.pop("evaluation_id", None)
        stored["resume_evidence"] = []  # EvidenceRef objects; briefing does not need them
        stored.setdefault("candidate_ref", session.candidate_id)
        stored.setdefault("candidate_name", session.candidate_name)
        valid = ScreeningContext.__dataclass_fields__.keys()
        return {k: v for k, v in stored.items() if k in valid}

    # ---------- serialization ----------

    def to_payload(self, session: ScreeningSession) -> dict[str, Any]:
        plan = list(session.plan or [])
        question = self.current_question(session)
        answered = len([t for t in (session.turns or []) if t.get("evaluation")])
        return {
            "session_id": session.id,
            "candidate_id": session.candidate_id,
            "candidate_name": session.candidate_name,
            "job_id": session.job_id,
            "job_title": session.job_title,
            "evaluation_id": session.evaluation_id,
            "status": session.status,
            "question_count": len(plan),
            "answered_count": answered,
            "current_question": question,
            "plan": plan,
            "turns": list(session.turns or []),
            "scorecard": dict(session.scorecard or {}),
            "briefing": dict(session.briefing or {}),
            "created_at": session.created_at,
            "completed_at": session.completed_at,
        }


screening_service = ScreeningService()
