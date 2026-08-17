import hashlib
import re
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.evaluation import AgentSession
from app.models.job_posting import JobPosting
from app.services.azure_services import openai_service
from app.services.candidate_comparison import candidate_comparison
from app.services.candidate_matcher import candidate_matcher
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

        ranked = await candidate_matcher.rank_candidates(db, job.id, persist=True)
        top = ranked[:10]

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
        context_block = self._build_context(job, ranked, top, user_query)

        # Prefer Chat-with-Your-Data accelerator when available
        source = "local"
        citations: list[Any] = []
        external_conversation_id = chatbot_conversation_id
        assistant_response: Optional[str] = None

        dimension_answer = self._extract_dimension_query(user_query, ranked)
        compare_ids = self._extract_compare_ids(user_query, ranked)
        if dimension_answer:
            assistant_response = dimension_answer
            source = "local"
        elif compare_ids and len(compare_ids) >= 2:
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
        }

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
        compact_top = []
        for item in top:
            dimensions = item.get("dimensions") or {}
            compact_top.append(
                {
                    "name": item.get("name"),
                    "overall_score": item.get("overall_score"),
                    "technical_skills": (dimensions.get("technical_skills") or {}).get("score"),
                    "communication": (dimensions.get("communication") or {}).get("score"),
                    "role_alignment": (dimensions.get("role_alignment") or {}).get("score"),
                }
            )
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
{compact_top}

User question: {user_query}

Respond with specific candidate recommendations, insights, and explanations.
Mention candidate names and overall scores when relevant.
When the question mentions technical skills, communication, role alignment, or overall fit, reason over those dimensions directly.
""".strip()

    def _dimension_key(self, query: str) -> Optional[str]:
        lower = query.lower()
        for phrase, key in [
            ("technical skills", "technical_skills"),
            ("communication", "communication"),
            ("role alignment", "role_alignment"),
            ("overall fit", "overall_fit"),
        ]:
            if phrase in lower:
                return key
        return None

    def _dimension_score(self, item: dict[str, Any], dimension: str) -> float:
        dimensions = item.get("dimensions") or {}
        if dimension == "overall_fit":
            return float((dimensions.get("overall_fit") or {}).get("score") or item.get("overall_score") or 0)
        return float((dimensions.get(dimension) or {}).get("score") or item.get("overall_score") or 0)

    def _extract_dimension_query(self, query: str, ranked: list[dict[str, Any]]) -> Optional[str]:
        dimension = self._dimension_key(query)
        if not dimension:
            return None

        lower = query.lower()
        if any(word in lower for word in ["strongest", "highest", "best", "top", "show me", "list"]):
            ordered = sorted(ranked, key=lambda item: self._dimension_score(item, dimension), reverse=True)
            header = dimension.replace("_", " ").title()
            lines = []
            for item in ordered[:5]:
                lines.append(
                    f"- **{item.get('name')}**: {self._dimension_score(item, dimension):.1f}"
                )
            return f"**{header} leaders**\n\n" + "\n".join(lines)
        return None

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
