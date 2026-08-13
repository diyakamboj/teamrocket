import hashlib
import re
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.evaluation import AgentSession
from app.models.job_posting import JobPosting
from app.models.schemas import WeightConfig
from app.services.candidate_comparison import candidate_comparison
from app.services.copilot_agent import copilot_answer
from app.services.copilot_pool import extract_candidate_ids
from app.services.chatbot_client import chatbot_client
from app.utils.error_handlers import NotFoundError
from app.utils.logger import get_logger

logger = get_logger(__name__)


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

        job = db.query(JobPosting).order_by(JobPosting.created_at.desc()).first()
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
        blind_mode: bool = False,
        weights: Optional[WeightConfig] = None,
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

        history = list(session.messages or [])
        compare_ids = await self._extract_compare_ids(user_query, db, job.id, blind_mode)
        source = "local"
        citations: list[Any] = []
        external_conversation_id = chatbot_conversation_id
        assistant_response: Optional[str] = None
        engine = "deterministic"
        tools: list[str] = []

        if compare_ids and len(compare_ids) >= 2:
            comparison = await candidate_comparison.compare(
                db, job.id, compare_ids, blind_mode=blind_mode
            )
            assistant_response = comparison["comparison"]
            source = "local"
            engine = "comparison"
        else:
            result = await copilot_answer(
                db=db,
                job=job,
                question=user_query,
                blind=blind_mode,
                weights=weights,
            )
            assistant_response = result["answer"]
            citations = result.get("citations") or []
            engine = result.get("engine") or "agent"
            tools = result.get("tools") or []
            source = "agent" if engine == "agent" else "local"
            pool = result.get("pool") or []

            # Optional CWYD enrichment when local agent is deterministic and CWYD is up
            if engine == "deterministic" and chatbot_client.enabled:
                try:
                    cwyd_messages = self._to_cwyd_messages(history, assistant_response, user_query)
                    cwyd = await chatbot_client.ask(
                        messages=cwyd_messages,
                        conversation_id=chatbot_conversation_id,
                        user_id=self._stable_user_id(recruiter_email),
                    )
                    if cwyd.get("content"):
                        assistant_response = cwyd["content"]
                        citations = cwyd.get("citations") or citations
                        external_conversation_id = cwyd.get("conversation_id") or chatbot_conversation_id
                        source = "chatbot"
                        engine = "chatbot"
                except Exception as exc:
                    logger.warning("Chatbot accelerator unavailable, using local agent: %s", exc)

            candidates_referenced = extract_candidate_ids(assistant_response or "", pool)
            history.append({"role": "user", "content": user_query})
            history.append(
                {
                    "role": "assistant",
                    "content": assistant_response,
                    "metadata": {
                        "source": source,
                        "engine": engine,
                        "tools": tools,
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
                "candidates_referenced": candidates_referenced,
                "chat_turn": len(history) // 2,
                "source": source,
                "engine": engine,
                "tools": tools,
                "citations": citations,
                "chatbot_conversation_id": external_conversation_id,
                "job_id": job.id,
            }

        history.append({"role": "user", "content": user_query})
        history.append(
            {
                "role": "assistant",
                "content": assistant_response,
                "metadata": {
                    "source": source,
                    "engine": engine,
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
            "candidates_referenced": compare_ids,
            "chat_turn": len(history) // 2,
            "source": source,
            "engine": engine,
            "tools": tools,
            "citations": citations,
            "chatbot_conversation_id": external_conversation_id,
            "job_id": job.id,
        }

    def list_sessions(self, db: Session, recruiter_email: Optional[str] = None) -> list[AgentSession]:
        query = db.query(AgentSession).order_by(AgentSession.updated_at.desc())
        if recruiter_email:
            query = query.filter(AgentSession.recruiter_email == recruiter_email)
        return query.limit(50).all()

    def _to_cwyd_messages(
        self,
        history: list[dict[str, Any]],
        context_answer: str,
        user_query: str,
    ) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = []
        for turn in history[-8:]:
            role = turn.get("role")
            content = turn.get("content")
            if role in {"user", "assistant"} and content:
                messages.append({"role": role, "content": str(content)})
        messages.append(
            {
                "role": "user",
                "content": f"{user_query}\n\nLocal screening context:\n{context_answer}",
            }
        )
        return messages

    @staticmethod
    def _stable_user_id(email: str) -> str:
        digest = hashlib.md5(email.encode("utf-8")).hexdigest()
        return f"{digest[:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:32]}"

    async def _extract_compare_ids(
        self,
        query: str,
        db: Session,
        job_id: UUID,
        blind_mode: bool,
    ) -> list[UUID]:
        if "compare" not in query.lower():
            return []
        from app.services.candidate_matcher import candidate_matcher

        ranked = await candidate_matcher.rank_candidates(
            db, job_id, persist=False, blind_mode=blind_mode
        )
        return self._extract_candidate_ids_from_ranked(query, ranked)

    def _extract_candidate_ids_from_ranked(
        self, text: str, ranked: list[dict[str, Any]]
    ) -> list[UUID]:
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


recruiter_agent = RecruiterCopilot()
