import hashlib
import re
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.candidate import Candidate
from app.models.evaluation import AgentSession
from app.models.job_posting import JobPosting
from app.models.screening import ScreeningSession
from app.services.azure_services import openai_service
from app.services.candidate_comparison import candidate_comparison
from app.services.candidate_matcher import candidate_matcher
from app.services.chatbot_client import chatbot_client
from app.services.screening_service import STATUS_COMPLETED, screening_service
from app.utils.error_handlers import NotFoundError
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: Phrases that open an L1 screening from the chat box. An explicit verb (or
#: a message that opens with "screen") is required so that merely discussing
#: screening — "what's her screening score?" — does not start one.
SCREENING_START_PATTERN = re.compile(
    r"\b(?:start|run|begin|conduct|open|do)\b[^.?!]{0,40}?\bscreen(?:ing)?\b"
    r"|^\s*screen\b",
    re.IGNORECASE,
)
#: Phrases that ask for the interviewer handover document.
BRIEFING_PATTERN = re.compile(
    r"\b(?:pre[\s-]?interview\s+)?brief(?:ing|\s+me)?\b|\bhandover\b", re.IGNORECASE
)
#: Escape hatches while a screening conversation holds the chat box.
SCREENING_STOP_PATTERN = re.compile(
    r"\b(?:stop|end|finish|cancel|abort|quit|exit)\s+(?:the\s+)?screen(?:ing)?\b", re.IGNORECASE
)
SCREENING_SKIP_PATTERN = re.compile(
    r"^\s*(?:skip|next\s+question|pass)\s*[.!]?\s*$", re.IGNORECASE
)

#: Filler stripped when reading a candidate name out of a screening command.
_NAME_NOISE = re.compile(
    r"\b(?:start|run|begin|conduct|open|do|an?|the|l1|level[\s-]?1|preliminary|initial|phone|"
    r"screen(?:ing)?|session|for|on|with|candidate|please|pre[\s-]?interview|brief(?:ing)?|"
    r"handover|generate|show|me|get)\b",
    re.IGNORECASE,
)


class RecruiterCopilot:
    async def ensure_default_job(self, db: Session, recruiter_email: str) -> JobPosting:
        job = (
            db.query(JobPosting)
            .filter(JobPosting.created_by == recruiter_email)
            .order_by(JobPosting.created_at.desc())
            .first()
        )
        if job:
            return job

        job = (
            db.query(JobPosting)
            .order_by(JobPosting.created_at.desc())
            .first()
        )
        if job:
            return job

        job = JobPosting(
            title="Backend Engineer",
            description=(
                "We are hiring a Backend Engineer with Python, FastAPI/SQL, Azure, "
                "and Docker experience. Nice to have: Kubernetes and Terraform."
            ),
            required_skills=["Python", "SQL", "Azure", "Docker"],
            required_experience_years=3,
            education_requirements="Bachelor's in Computer Science or equivalent",
            nice_to_have_skills=["Kubernetes", "Terraform"],
            created_by=recruiter_email,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        return job

    async def query_candidates(
        self,
        db: Session,
        *,
        user_query: str,
        recruiter_email: str,
        job_id: Optional[UUID] = None,
        session_id: Optional[UUID] = None,
        chatbot_conversation_id: Optional[str] = None,
    ) -> dict[str, Any]:
        if job_id:
            job = db.get(JobPosting, job_id)
            if not job:
                raise NotFoundError("Job posting not found", {"job_id": str(job_id)})
        else:
            job = await self.ensure_default_job(db, recruiter_email)

        session = None
        if session_id:
            session = db.get(AgentSession, session_id)
        if not session:
            session = AgentSession(
                recruiter_email=recruiter_email,
                job_id=job.id,
                messages=[],
            )
            db.add(session)
            db.flush()

        # An L1 screening turn owns the whole exchange: it neither needs the
        # ranked pool nor should it be answered by the general chat model.
        screening_result = self._handle_screening_turn(
            db,
            user_query=user_query,
            recruiter_email=recruiter_email,
            job=job,
            session=session,
        )
        if screening_result:
            return screening_result

        ranked = await candidate_matcher.rank_candidates(db, job.id, persist=True)
        top = ranked[:10]

        history = list(session.messages or [])
        context_block = self._build_context(job, ranked, top, user_query)

        # Prefer Chat-with-Your-Data accelerator when available
        source = "local"
        citations: list[Any] = []
        external_conversation_id = chatbot_conversation_id
        assistant_response: Optional[str] = None

        compare_ids = self._extract_compare_ids(user_query, ranked)
        if compare_ids and len(compare_ids) >= 2:
            comparison = await candidate_comparison.compare(db, job.id, compare_ids)
            assistant_response = comparison["comparison"]
            source = "local"
        elif chatbot_client.enabled:
            try:
                cwyd_messages = self._to_cwyd_messages(history, context_block)
                result = await chatbot_client.ask(
                    messages=cwyd_messages,
                    conversation_id=chatbot_conversation_id,
                    user_id=self._stable_user_id(recruiter_email),
                )
                assistant_response = result.get("content") or ""
                citations = result.get("citations") or []
                external_conversation_id = result.get("conversation_id") or chatbot_conversation_id
                source = "chatbot"
            except Exception as exc:
                logger.warning("Chatbot accelerator unavailable, using local agent: %s", exc)

        if not assistant_response:
            messages = [
                {"role": "system", "content": "You are an expert technical recruiter copilot."}
            ]
            messages.extend(history)
            messages.append({"role": "user", "content": context_block})
            assistant_response = openai_service.chat_text(
                context_block,
                messages=messages,
                temperature=0.7,
                max_tokens=1000,
            )
            source = "local"

        history.append({"role": "user", "content": user_query})
        history.append(
            {
                "role": "assistant",
                "content": assistant_response,
                "metadata": {
                    "source": source,
                    "citations": citations,
                    "chatbot_conversation_id": external_conversation_id,
                },
            }
        )
        session.messages = history
        db.commit()
        db.refresh(session)

        return {
            "session_id": session.id,
            "response": assistant_response,
            "candidates_referenced": self._extract_candidate_ids(assistant_response, ranked),
            "chat_turn": len(history) // 2,
            "source": source,
            "citations": citations,
            "chatbot_conversation_id": external_conversation_id,
            "job_id": job.id,
            "screening": None,
        }

    # ---------- L1 screening in the chat box ----------

    def _handle_screening_turn(
        self,
        db: Session,
        *,
        user_query: str,
        recruiter_email: str,
        job: JobPosting,
        session: AgentSession,
    ) -> Optional[dict[str, Any]]:
        """Route this turn into the screening workflow, or return None.

        Order matters: an open screening session claims the input first, so a
        candidate answering "I don't know" is recorded as an answer rather
        than being sent to the general copilot as a question.
        """
        active = self._active_screening_for_chat(db, session)

        if active:
            if SCREENING_STOP_PATTERN.search(user_query):
                closed = screening_service.complete_session(db, session_id=active.id)
                return self._screening_reply(
                    db,
                    session=session,
                    user_query=user_query,
                    screening=closed,
                    text=(
                        f"Screening for **{closed.candidate_name}** closed early.\n\n"
                        + self._render_briefing(closed)
                    ),
                )
            if SCREENING_SKIP_PATTERN.match(user_query):
                skipped = screening_service.skip_question(db, session_id=active.id)
                return self._screening_reply(
                    db,
                    session=session,
                    user_query=user_query,
                    screening=skipped,
                    text=self._render_state(skipped, prefix="Skipped."),
                )

            answered = screening_service.submit_answer(
                db, session_id=active.id, answer=user_query
            )
            return self._screening_reply(
                db,
                session=session,
                user_query=user_query,
                screening=answered,
                text=self._render_state(answered),
            )

        if BRIEFING_PATTERN.search(user_query):
            target = self._find_screening_session(db, user_query, recruiter_email)
            if not target:
                return self._screening_reply(
                    db,
                    session=session,
                    user_query=user_query,
                    screening=None,
                    text=(
                        "No completed screening found for that candidate. Start one with "
                        "“screen <candidate name>”, and I'll write the briefing when it ends."
                    ),
                )
            if target.status != STATUS_COMPLETED:
                target = screening_service.complete_session(db, session_id=target.id)
            return self._screening_reply(
                db,
                session=session,
                user_query=user_query,
                screening=target,
                text=self._render_briefing(target),
            )

        if not SCREENING_START_PATTERN.search(user_query):
            return None

        candidate = self._find_candidate(db, user_query)
        if not candidate:
            names = [
                c.name
                for c in db.query(Candidate).order_by(Candidate.created_at.desc()).limit(5).all()
            ]
            hint = f" Candidates I can screen: {', '.join(names)}." if names else ""
            return self._screening_reply(
                db,
                session=session,
                user_query=user_query,
                screening=None,
                text=(
                    "Tell me who to screen — for example “start screening for Alice Johnson”."
                    + hint
                ),
            )

        started = screening_service.start_session(
            db,
            recruiter_email=recruiter_email,
            candidate_id=candidate.id,
            job_id=job.id,
        )
        intro = (
            f"Starting L1 screening for **{started.candidate_name}** — {started.job_title}.\n"
            f"{len(started.plan or [])} questions, generated from this candidate's profile and the "
            f"role requirements. Answer here as the candidate responds; say “skip” to move on or "
            f"“stop screening” to end early and get the briefing."
        )
        return self._screening_reply(
            db,
            session=session,
            user_query=user_query,
            screening=started,
            text=self._render_state(started, prefix=intro),
        )

    @staticmethod
    def _active_screening_for_chat(
        db: Session, session: AgentSession
    ) -> Optional[ScreeningSession]:
        """The screening this chat thread started, if it is still open.

        Scoped to the thread rather than the recruiter, so a screen running in
        another tab (or started from the screening page) never swallows an
        unrelated question typed here.
        """
        for message in reversed(list(session.messages or [])):
            raw = (message.get("metadata") or {}).get("screening_session_id")
            if not raw:
                continue
            try:
                screening = db.get(ScreeningSession, UUID(str(raw)))
            except ValueError:
                return None
            if screening and screening.status not in {STATUS_COMPLETED, "abandoned"}:
                return screening
            return None
        return None

    def _find_candidate(self, db: Session, query: str) -> Optional[Candidate]:
        for match in re.findall(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            query,
            flags=re.IGNORECASE,
        ):
            candidate = db.get(Candidate, UUID(match))
            if candidate:
                return candidate

        name = self._extract_name(query)
        if not name:
            return None
        return (
            db.query(Candidate)
            .filter(Candidate.name.ilike(f"%{name}%"))
            .order_by(Candidate.created_at.desc())
            .first()
        )

    @staticmethod
    def _extract_name(query: str) -> str:
        stripped = _NAME_NOISE.sub(" ", query)
        stripped = re.sub(r"[^A-Za-z\s'-]", " ", stripped)
        return " ".join(stripped.split()).strip()

    def _find_screening_session(
        self, db: Session, query: str, recruiter_email: str
    ) -> Optional[ScreeningSession]:
        candidate = self._find_candidate(db, query)
        if candidate:
            sessions = screening_service.list_sessions(
                db, candidate_id=str(candidate.id), limit=1
            )
            if sessions:
                return sessions[0]

        name = self._extract_name(query)
        if name:
            match = (
                db.query(ScreeningSession)
                .filter(ScreeningSession.candidate_name.ilike(f"%{name}%"))
                .order_by(ScreeningSession.created_at.desc())
                .first()
            )
            if match:
                return match

        sessions = screening_service.list_sessions(db, recruiter_email=recruiter_email, limit=1)
        return sessions[0] if sessions else None

    def _screening_reply(
        self,
        db: Session,
        *,
        session: AgentSession,
        user_query: str,
        screening: Optional[ScreeningSession],
        text: str,
    ) -> dict[str, Any]:
        history = list(session.messages or [])
        history.append({"role": "user", "content": user_query})
        history.append(
            {
                "role": "assistant",
                "content": text,
                "metadata": {
                    "source": "screening",
                    "screening_session_id": str(screening.id) if screening else None,
                },
            }
        )
        session.messages = history
        db.commit()
        db.refresh(session)

        return {
            "session_id": session.id,
            "response": text,
            "candidates_referenced": [],
            "chat_turn": len(history) // 2,
            "source": "screening",
            "citations": [],
            "chatbot_conversation_id": None,
            "job_id": session.job_id,
            "screening": screening_service.to_payload(screening) if screening else None,
        }

    @staticmethod
    def _render_state(screening: ScreeningSession, *, prefix: str = "") -> str:
        parts = [prefix] if prefix else []
        turns = list(screening.turns or [])
        answered = [t for t in turns if t.get("evaluation")]

        if answered and not prefix:
            last = answered[-1]["evaluation"]
            notes = " ".join(last.get("notes") or [])
            parts.append(
                f"Scored that answer **{float(last.get('score') or 0):.0f}/100** "
                f"({last.get('rating')}). {notes}".strip()
            )

        question = screening_service.current_question(screening)
        if question:
            parts.append(
                f"**Question {question.get('order')} of {len(screening.plan or [])}** "
                f"({str(question.get('competency') or '').replace('_', ' ')})\n"
                f"{question.get('question')}"
            )
        else:
            scorecard = screening.scorecard or {}
            parts.append(
                f"Screening complete — **{float(scorecard.get('overall_score') or 0):.0f}/100**, "
                f"recommendation: **{str(scorecard.get('recommendation') or 'n/a').replace('_', ' ')}**.\n\n"
                + RecruiterCopilot._render_briefing(screening)
            )
        return "\n\n".join(p for p in parts if p).strip()

    @staticmethod
    def _render_briefing(screening: ScreeningSession) -> str:
        briefing = screening.briefing or {}
        if not briefing:
            return "No briefing available yet — the screening has not produced any answers."

        lines = [
            f"**Pre-interview briefing — {screening.candidate_name}** ({screening.job_title})",
            briefing.get("summary", ""),
        ]

        performance = briefing.get("screening_performance") or {}
        by_category = performance.get("by_category") or []
        if by_category:
            lines.append(
                "**Screening performance**\n"
                + "\n".join(
                    f"• {c['label']}: {float(c['score']):.0f}/100 ({c['rating']})"
                    for c in by_category
                )
            )

        for key, title in (
            ("strengths", "Strengths"),
            ("weaknesses", "Weaknesses"),
            ("concerns", "Concerns"),
        ):
            items = briefing.get(key) or []
            if items:
                lines.append(
                    f"**{title}**\n" + "\n".join(f"• {item['point']}" for item in items[:4])
                )

        gaps = briefing.get("skill_gaps") or []
        if gaps:
            lines.append(
                "**Skill gaps**\n"
                + "\n".join(f"• {g['skill']} — {g['finding']}" for g in gaps[:4])
            )

        areas = briefing.get("recommended_areas") or []
        if areas:
            lines.append(
                "**Explore in the interview**\n"
                + "\n".join(
                    f"• {a['area']}: {a['suggested_question']}" for a in areas[:4]
                )
            )

        return "\n\n".join(line for line in lines if line).strip()

    def list_sessions(self, db: Session, recruiter_email: Optional[str] = None) -> list[AgentSession]:
        query = db.query(AgentSession).order_by(AgentSession.updated_at.desc())
        if recruiter_email:
            query = query.filter(AgentSession.recruiter_email == recruiter_email)
        return query.limit(50).all()

    def _build_context(
        self,
        job: JobPosting,
        ranked: list[dict[str, Any]],
        top: list[dict[str, Any]],
        user_query: str,
    ) -> str:
        return f"""
You are a recruiter assistant for ResumeIQ. Use the candidate pool and job requirements below.
Prefer grounded answers. If using retrieved documents, cite them.

Role: {job.title}
Required skills: {job.required_skills}
Nice to have: {job.nice_to_have_skills}
Years required: {job.required_experience_years}
Education: {job.education_requirements}

Candidate pool size: {len(ranked)}
Top 10 ranked candidates:
{top}

User question: {user_query}

Respond with specific candidate recommendations, insights, and explanations.
Mention candidate names and overall scores when relevant.
""".strip()

    def _to_cwyd_messages(
        self,
        history: list[dict[str, Any]],
        context_block: str,
    ) -> list[dict[str, str]]:
        """Map local session history into CWYD conversation messages."""
        messages: list[dict[str, str]] = []
        for turn in history[-8:]:
            role = turn.get("role")
            content = turn.get("content")
            if role in {"user", "assistant"} and content:
                messages.append({"role": role, "content": str(content)})
        # Final user turn includes screening context for grounding
        messages.append({"role": "user", "content": context_block})
        return messages

    @staticmethod
    def _stable_user_id(email: str) -> str:
        digest = hashlib.md5(email.encode("utf-8")).hexdigest()
        return f"{digest[:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:32]}"

    def _extract_candidate_ids(self, text: str, ranked: list[dict[str, Any]]) -> list[UUID]:
        found: list[UUID] = []
        lower = text.lower()
        for item in ranked:
            name = str(item.get("name") or "").lower()
            if name and name in lower:
                found.append(item["candidate_id"])
        for match in re.findall(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            text,
            flags=re.IGNORECASE,
        ):
            try:
                found.append(UUID(match))
            except ValueError:
                continue
        seen: set[UUID] = set()
        ordered: list[UUID] = []
        for cid in found:
            if cid not in seen:
                seen.add(cid)
                ordered.append(cid)
        return ordered[:10]

    def _extract_compare_ids(self, query: str, ranked: list[dict[str, Any]]) -> list[UUID]:
        if "compare" not in query.lower():
            return []
        return self._extract_candidate_ids(query, ranked)


recruiter_agent = RecruiterCopilot()
