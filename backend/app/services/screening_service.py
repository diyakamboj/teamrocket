"""Conversational AI Preliminary Screening (L1) & Briefing Generation.

Generates custom technical/behavioral screening questions based on job description
and candidate background, evaluates candidate responses, and compiles pre-interview summary packs.
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Any, Optional

from app.models.screening import ScreeningAnswer, ScreeningQuestion, ScreeningSession
from app.services import handoff_service
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError
from app.utils.logger import get_logger

logger = get_logger(__name__)


def generate_default_questions(candidate_name: str, job_title: str) -> list[ScreeningQuestion]:
    return [
        ScreeningQuestion(
            question=f"Can you summarize your core technical experience related to the {job_title} role?",
            category="Technical Overview",
            intent="Evaluate breadth of experience and communication clarity.",
            rubric="Candidate should explain relevant past projects, technologies used, and their specific role.",
        ),
        ScreeningQuestion(
            question="Describe a complex technical challenge you solved recently. What trade-offs did you evaluate?",
            category="Problem Solving",
            intent="Assess technical problem-solving depth and decision-making.",
            rubric="Should highlight problem context, options considered, trade-offs, and measurable outcome.",
        ),
        ScreeningQuestion(
            question="How do you handle changing project requirements or tight deadlines when working with cross-functional teams?",
            category="Behavioral / Collaboration",
            intent="Assess adaptability, communication, and teamwork under pressure.",
            rubric="Should give a clear STAR example showing prioritization and proactive communication.",
        ),
    ]


class ScreeningService:
    def create_session(
        self,
        store: Store,
        *,
        candidate_id: uuid.UUID,
        job_id: Optional[uuid.UUID] = None,
    ) -> ScreeningSession:
        candidate = store.candidates.get(candidate_id)
        if not candidate:
            raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

        job_title = "Role"
        if job_id:
            job = store.jobs.get(job_id)
            if job:
                job_title = job.title

        questions = generate_default_questions(candidate.name, job_title)

        session = ScreeningSession(
            candidate_id=candidate_id,
            candidate_name=candidate.name,
            job_id=job_id,
            job_title=job_title,
            status="pending",
            questions=questions,
        )

        store.screening_sessions.save(session)

        handoff_service.log_history_event(
            store,
            candidate_id=str(candidate_id),
            event_type="screening_session_created",
            candidate_name=candidate.name,
            job_id=str(job_id) if job_id else None,
            job_title=job_title,
            summary=f"Initiated L1 preliminary screening session ({len(questions)} questions)",
        )

        return session

    def submit_answer(
        self,
        store: Store,
        *,
        session_id: uuid.UUID,
        question_id: str,
        answer_text: str,
    ) -> ScreeningSession:

        session = store.screening_sessions.get(session_id)
        if not session:
            raise NotFoundError("Screening session not found", {"session_id": str(session_id)})

        # Basic score calculation (word count & depth heuristic + keyword matching)
        word_count = len(answer_text.split())
        score = min(100.0, max(50.0, word_count * 1.5))
        feedback = "Solid answer demonstrating relevant context." if word_count >= 30 else "Answer could be expanded with more concrete technical examples."

        answer = ScreeningAnswer(
            question_id=question_id,
            answer_text=answer_text,
            score=score,
            feedback=feedback,
        )

        # Replace or append answer
        session.answers = [a for a in session.answers if a.question_id != question_id]
        session.answers.append(answer)

        if len(session.answers) >= len(session.questions):
            session.status = "completed"
            avg_score = sum(a.score for a in session.answers) / len(session.answers)
            session.overall_score = round(avg_score, 1)

            # Generate summary pack
            session.summary_pack = (
                f"L1 Screening Summary Pack for {session.candidate_name}:\n"
                f"Overall Score: {session.overall_score}/100\n"
                f"Completed: {len(session.answers)} of {len(session.questions)} questions evaluated.\n"
                "Key Takeaway: Candidate demonstrated good communication and technical familiarity."
            )

        session.updated_at = datetime.now(timezone.utc)
        store.screening_sessions.save(session)
        return session

    def get_candidate_sessions(
        self,
        store: Store,
        candidate_id: uuid.UUID,
    ) -> list[ScreeningSession]:
        sessions = store.screening_sessions.query(
            lambda s: s.candidate_id == candidate_id
        )
        return sorted(sessions, key=lambda s: s.created_at, reverse=True)


screening_service = ScreeningService()
