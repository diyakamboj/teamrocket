import hashlib
from typing import Callable, Any, Optional
from uuid import UUID

from app.models.evaluation import AgentSession
from app.models.job_posting import JobPosting
from app.models.schemas import WeightConfig
from app.services import company_document_service
from app.services.copilot_agent import copilot_answer, is_analytics_query
from app.services.copilot_pool import extract_candidate_ids
from app.services.chatbot_client import chatbot_client
from app.services.jd_optimizer import jd_optimizer
from app.services.model_registry import model_registry
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError
from app.utils.logger import get_logger

logger = get_logger(__name__)


class RecruiterCopilot:
    async def ensure_default_job(self, store: Store, recruiter_email: str) -> JobPosting:
        own_jobs = sorted(
            store.jobs.query(lambda j: j.created_by == recruiter_email),
            key=lambda j: j.created_at,
            reverse=True,
        )
        if own_jobs:
            return own_jobs[0]

        all_jobs = sorted(store.jobs.list_all(), key=lambda j: j.created_at, reverse=True)
        if all_jobs:
            return all_jobs[0]

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
        store.jobs.save(job)
        return job

    async def analyze_jd_requirements(self, store: Store, job_id: UUID) -> dict[str, Any]:
        """Agent entry point for JD calibration — same payload the dashboard renders."""
        return await jd_optimizer.get_optimization(store, job_id)

    def _extract_analytics_query(self, query: str) -> bool:
        return is_analytics_query(query)

    async def query_candidates(
        self,
        store: Store,
        *,
        user_query: str,
        recruiter_email: str,
        job_id: Optional[UUID] = None,
        session_id: Optional[UUID] = None,
        chatbot_conversation_id: Optional[str] = None,
        blind_mode: bool = False,
        weights: Optional[WeightConfig] = None,
        candidate_id: Optional[UUID] = None,
        model_id: Optional[str] = None,
        attachment_ids: Optional[list[UUID]] = None,
        on_progress: Optional[Callable[[str, str], None]] = None,
    ) -> dict[str, Any]:
        if job_id:
            job = store.jobs.get(job_id)
            if not job:
                raise NotFoundError("Job posting not found", {"job_id": str(job_id)})
        else:
            job = await self.ensure_default_job(store, recruiter_email)

        resolved_model_id = model_registry.resolve(model_id, recruiter_email)
        deployment = model_registry.deployment_for(resolved_model_id)

        session = None
        if session_id:
            session = store.agent_sessions.get(session_id)
        is_new_session = session is None
        if not session:
            session = AgentSession(
                recruiter_email=recruiter_email,
                job_id=job.id,
                messages=[],
            )
        if is_new_session:
            if candidate_id:
                session.candidate_id = candidate_id
                candidate = store.candidates.get(candidate_id)
                if candidate:
                    session.candidate_name = candidate.name
            session.title = user_query[:80]
            store.agent_sessions.save(session)
        elif candidate_id and not session.candidate_id:
            # Backfill: an existing session with no bound candidate gets one
            # from this turn.
            session.candidate_id = candidate_id
            candidate = store.candidates.get(candidate_id)
            if candidate:
                session.candidate_name = candidate.name

        history = list(session.messages or [])
        source = "local"

        question = user_query
        for attachment_id in attachment_ids or []:
            attachment = store.chat_attachments.get(attachment_id)
            if attachment and attachment.status == "processed" and attachment.extracted_text:
                question += f"\n\n[Attached: {attachment.filename}]\n{attachment.extracted_text[:4000]}"

        # Company documents the recruiter uploaded in Settings — what makes
        # extracting them worth doing, rather than just storing the files.
        # Passed separately, not glued onto the question, so the stored chat
        # history keeps what the recruiter actually typed.
        company_context = company_document_service.context_for_recruiter(recruiter_email)

        result = await copilot_answer(
            db=store,
            job=job,
            question=question,
            company_context=company_context,
            **({"on_progress": on_progress} if on_progress else {}),
            blind=blind_mode,
            weights=weights,
            model_id=resolved_model_id,
            deployment=deployment,
            focus_candidate_id=str(candidate_id) if candidate_id else None,
        )
        assistant_response = result["answer"]
        citations = result.get("citations") or []
        engine = result.get("engine") or "agent"
        tools = result.get("tools") or []
        source = "agent" if engine == "agent" else "local"
        pool = result.get("pool") or []
        structured = result.get("structured")

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
                    chatbot_conversation_id = cwyd.get("conversation_id") or chatbot_conversation_id
                    source = "chatbot"
                    engine = "chatbot"
                    # CWYD's prose doesn't correspond to the locally-computed
                    # structured payload — don't show a stale one alongside it.
                    structured = None
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
                    "chatbot_conversation_id": chatbot_conversation_id,
                },
            }
        )
        session.messages = history
        store.agent_sessions.save(session)

        return {
            "session_id": session.id,
            "response": assistant_response,
            "candidates_referenced": candidates_referenced,
            "chat_turn": len(history) // 2,
            "source": source,
            "engine": engine,
            "tools": tools,
            "citations": citations,
            "chatbot_conversation_id": chatbot_conversation_id,
            "job_id": job.id,
            "candidate_id": session.candidate_id,
            "model_id": result.get("model_id") or resolved_model_id,
            "structured": structured,
        }

    def list_sessions(
        self,
        store: Store,
        recruiter_email: Optional[str] = None,
        candidate_id: Optional[UUID] = None,
    ) -> list[AgentSession]:
        sessions = store.agent_sessions.list_all()
        if recruiter_email:
            sessions = [s for s in sessions if s.recruiter_email == recruiter_email]
        if candidate_id:
            sessions = [s for s in sessions if s.candidate_id == candidate_id]
        sessions.sort(key=lambda s: s.updated_at, reverse=True)
        return sessions[:50]

    def _build_context(
        self,
        job: JobPosting,
        ranked: list[dict[str, Any]],
        top: list[dict[str, Any]],
        user_query: str,
        *,
        blind_mode: bool = False,
    ) -> str:
        """Compact pool snapshot for tests and Chat-with-Your-Data fallbacks."""
        identity = (
            "Blind review is ON. Refer to candidates only by their anonymized labels; "
            "do not infer or reveal real names or emails."
            if blind_mode
            else "Blind review is OFF. Candidate names may be shown."
        )
        compact = [
            {
                "name": item.get("name"),
                "overall_score": item.get("overall_score"),
            }
            for item in top
        ]
        return (
            f"Role: {job.title}\n"
            f"{identity}\n"
            f"Candidate pool size: {len(ranked)}\n"
            f"Top candidates: {compact}\n"
            f"User question: {user_query}"
        )

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


recruiter_agent = RecruiterCopilot()
