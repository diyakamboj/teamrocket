"""Bounded Recruiter Copilot: select a tool → run it on the scored pool → synthesize."""

from __future__ import annotations

import json
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models.candidate import Candidate
from app.models.evaluation import AgentSession, Evaluation, Evidence
from app.models.job_posting import JobPosting
from app.services.agent_tools import (
    TOOL_NAMES,
    attach_default_citations,
    execute_tool,
    format_tool_result,
    is_uuid,
    match_focus,
    resolve_citations,
    select_tool_heuristic,
)
from app.services.azure_services import openai_service
from app.services.candidate_matcher import candidate_matcher
from app.utils.error_handlers import NotFoundError
from app.utils.logger import get_logger
from app.utils.validators import redact_identity

logger = get_logger(__name__)

SYSTEM_PROMPT = """You are ResumeIQ Recruiter Copilot, a bounded recruiting assistant.

You never invent candidates, scores, skills, or resume evidence.
You pick exactly one tool. That tool reads the already-scored candidate pool.
You then write a concise recruiter-facing answer using only the tool result.

When quoting evidence, cite it as [evidence:<uuid>] using only IDs present in the tool result.
If the tool result is insufficient, say so and suggest a more specific question.
Blind review: use display_name only. Never reveal real names, emails, or phones.
""".strip()

TOOL_SELECT_PROMPT = """Choose exactly one tool for this recruiter question.

Return JSON only:
{{"tool": "<name>", "args": {{}}, "reason": "<short>"}}

Available tools:
- search_candidates: find/filter the scored pool (args: query, skills, limit, min_score)
- get_verdicts: interview/hire recommendations for focused or top candidates
- compare: side-by-side of 2+ candidates
- gap_summary: pool-wide qualification / skill gaps for the job
- must_have_report: who meets or misses required/must-have skills
- clarify: empty, off-topic, or too ambiguous to ground in the pool

User query: {query}
Job: {job_title}
Focus candidate count: {focus_count}
Recent conversation:
{history}
""".strip()

SYNTHESIS_PROMPT = """Rewrite the tool result as a tight recruiter answer.

Rules:
- Use only facts in TOOL_RESULT_JSON. Do not add candidates, scores, or skills.
- Cite resume evidence as [evidence:<uuid>] using only those IDs.
- Markdown: one bold headline, bullets, optional **Next step** line.
- Keep it under 180 words.
- Blind mode is {blind_mode}. If true, never use real names or contact info.

TOOL_RESULT_JSON:
{tool_json}
""".strip()


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
        candidate_ids: Optional[list[Any]] = None,
        focus_names: Optional[list[str]] = None,
        context_candidates: Optional[list[Any]] = None,
        job_title: Optional[str] = None,
        blind_mode: bool = False,
    ) -> dict[str, Any]:
        calls_before = openai_service.llm_calls
        tokens_before = (
            openai_service.estimated_prompt_tokens,
            openai_service.estimated_completion_tokens,
        )

        if job_id:
            job = db.get(JobPosting, job_id)
            if not job:
                raise NotFoundError("Job posting not found", {"job_id": str(job_id)})
        else:
            job = await self.ensure_default_job(db, recruiter_email)

        pool, pool_reused = await self._scored_pool(db, job, persist=True, blind_mode=blind_mode)
        if not pool:
            pool = self._synthetic_pool(context_candidates or [], job, blind_mode)

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
        history_text = self._history_text(history)
        prior_ids = self._prior_candidate_ids(history)
        merged_ids = list(candidate_ids or []) + prior_ids

        focus = match_focus(
            pool,
            candidate_ids=merged_ids,
            focus_names=focus_names,
            query=user_query,
        )
        job_ctx = self._job_context(job, job_title)

        tool_name, tool_args, selection_source = self._select_tool(
            user_query,
            focus_count=len(focus),
            history_text=history_text,
            job_title=str(job_ctx.get("title") or job.title),
        )
        tool_result = execute_tool(
            tool_name,
            tool_args,
            pool=pool,
            job=job_ctx,
            focus=focus,
            blind_mode=blind_mode,
            query=user_query,
        )
        allowed = tool_result.get("evidence_index") or {}

        source = "local"
        deterministic = format_tool_result(tool_result)
        assistant_response = self._synthesize(tool_result, blind_mode=blind_mode)
        if not assistant_response:
            assistant_response = deterministic
            source = "fallback"
        elif assistant_response.strip() == deterministic.strip():
            source = "local"

        assistant_response, citations = resolve_citations(assistant_response, allowed)
        citations = attach_default_citations(citations, allowed)
        if blind_mode:
            assistant_response = redact_identity(
                assistant_response,
                [str(row.get("legal_name") or row.get("name") or "") for row in pool],
            )
            citations = self._redact_citations(
                citations,
                [str(row.get("legal_name") or row.get("name") or "") for row in pool],
            )

        llm_calls = openai_service.llm_calls - calls_before
        usage = {
            "llm_calls": llm_calls,
            "estimated_prompt_tokens": openai_service.estimated_prompt_tokens - tokens_before[0],
            "estimated_completion_tokens": openai_service.estimated_completion_tokens - tokens_before[1],
            "selection_source": selection_source,
            "pool_size": len(pool),
            "pool_reused": pool_reused,
            "tool": tool_result["tool"],
        }

        history.append({"role": "user", "content": user_query})
        history.append(
            {
                "role": "assistant",
                "content": assistant_response,
                "metadata": {
                    "source": source,
                    "tool": tool_result["tool"],
                    "citations": citations,
                    "candidates_referenced": tool_result.get("candidate_ids") or [],
                    "usage": usage,
                    "chatbot_conversation_id": chatbot_conversation_id,
                },
            }
        )
        session.messages = history
        db.commit()
        db.refresh(session)

        referenced = [UUID(cid) for cid in (tool_result.get("candidate_ids") or []) if is_uuid(cid)]
        return {
            "session_id": session.id,
            "response": assistant_response,
            "candidates_referenced": referenced[:10],
            "chat_turn": len(history) // 2,
            "source": source,
            "citations": citations,
            "chatbot_conversation_id": chatbot_conversation_id,
            "job_id": job.id,
            "tool_used": tool_result["tool"],
            "usage": usage,
        }

    def list_sessions(self, db: Session, recruiter_email: Optional[str] = None) -> list[AgentSession]:
        query = db.query(AgentSession).order_by(AgentSession.updated_at.desc())
        if recruiter_email:
            query = query.filter(AgentSession.recruiter_email == recruiter_email)
        return query.limit(50).all()

    def _select_tool(
        self,
        user_query: str,
        *,
        focus_count: int,
        history_text: str,
        job_title: str,
    ) -> tuple[str, dict[str, Any], str]:
        heuristic_name, heuristic_args = select_tool_heuristic(
            user_query, focus_count=focus_count, history_text=history_text
        )
        prompt = TOOL_SELECT_PROMPT.format(
            query=user_query,
            job_title=job_title or "(unknown role)",
            focus_count=focus_count,
            history=history_text or "(none)",
        )
        selected = openai_service.try_chat_json(
            prompt,
            system=SYSTEM_PROMPT + " Return valid JSON only.",
            temperature=0.0,
            max_tokens=220,
        )
        if not selected:
            return heuristic_name, heuristic_args, "heuristic"
        name = str(selected.get("tool") or "").strip()
        if name not in TOOL_NAMES:
            return heuristic_name, heuristic_args, "heuristic"
        args = selected.get("args") if isinstance(selected.get("args"), dict) else {}
        return name, args, "llm"

    def _synthesize(self, tool_result: dict[str, Any], *, blind_mode: bool) -> Optional[str]:
        compact = {
            "tool": tool_result.get("tool"),
            "ok": tool_result.get("ok"),
            "headline": tool_result.get("headline"),
            "payload": self._llm_safe_payload(tool_result.get("payload") or {}),
        }
        prompt = SYNTHESIS_PROMPT.format(
            blind_mode=str(blind_mode).lower(),
            tool_json=json.dumps(compact, default=str)[:6000],
        )
        text = openai_service.try_chat_text(
            prompt,
            system=SYSTEM_PROMPT,
            temperature=0.2,
            max_tokens=700,
        )
        if not text:
            return None
        lower = text.lower()
        if "based on the ranked candidate pool" in lower:
            return None
        if "answer is limited to the" in lower:
            return None
        names = [
            str(c.get("display_name") or "")
            for c in (tool_result.get("payload") or {}).get("candidates") or []
            if c.get("display_name")
        ]
        if names and not any(name.lower() in lower for name in names):
            return None
        return text.strip()

    def _llm_safe_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Keep evidence IDs for citation, omit long free-text that invites invention."""
        safe = dict(payload)
        candidates = []
        for row in payload.get("candidates") or []:
            evidence = [
                {
                    "id": ev.get("id"),
                    "skill_name": ev.get("skill_name"),
                    "source_section": ev.get("source_section"),
                    "resume_text_snippet": (ev.get("resume_text_snippet") or "")[:180],
                }
                for ev in (row.get("evidence") or [])[:4]
            ]
            candidates.append(
                {
                    "display_name": row.get("display_name"),
                    "rank": row.get("rank"),
                    "overall_score": row.get("overall_score"),
                    "skill_score": row.get("skill_score"),
                    "experience_score": row.get("experience_score"),
                    "verdict": row.get("verdict"),
                    "matched_skills": row.get("matched_skills"),
                    "missing_skills": row.get("missing_skills"),
                    "evidence": evidence,
                }
            )
        safe["candidates"] = candidates
        return safe

    async def _scored_pool(
        self,
        db: Session,
        job: JobPosting,
        *,
        persist: bool,
        blind_mode: bool,
    ) -> tuple[list[dict[str, Any]], bool]:
        candidates = db.query(Candidate).all()
        if not candidates:
            return [], False

        evaluations = (
            db.query(Evaluation)
            .options(joinedload(Evaluation.evidence_items), joinedload(Evaluation.candidate))
            .filter(Evaluation.job_id == job.id)
            .all()
        )
        by_cand = {e.candidate_id: e for e in evaluations}
        if candidates and all(c.id in by_cand for c in candidates):
            pool = self._hydrate_from_evaluations(candidates, by_cand, blind_mode)
            return pool, True

        ranked = await candidate_matcher.rank_candidates(
            db, job.id, persist=persist, blind_mode=False
        )
        return self._attach_evidence(db, ranked, blind_mode), False

    def _hydrate_from_evaluations(
        self,
        candidates: list[Candidate],
        by_cand: dict[Any, Evaluation],
        blind_mode: bool,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for candidate in candidates:
            evaluation = by_cand[candidate.id]
            evidence = []
            for item in evaluation.evidence_items or []:
                snippet = item.resume_text_snippet or ""
                if blind_mode:
                    snippet = redact_identity(snippet, [candidate.name])
                evidence.append(
                    {
                        "id": str(item.id),
                        "skill_name": item.skill_name,
                        "resume_text_snippet": snippet,
                        "source_section": item.source_section,
                        "confidence_score": float(item.confidence_score) if item.confidence_score is not None else None,
                    }
                )
            name = candidate.name
            rows.append(
                {
                    "candidate_id": candidate.id,
                    "name": name,
                    "legal_name": candidate.name,
                    "email": None if blind_mode else candidate.email,
                    "overall_score": float(evaluation.overall_score or 0),
                    "skill_score": float(evaluation.skill_match_score or 0),
                    "experience_score": float(evaluation.experience_match_score or 0),
                    "education_score": float(evaluation.education_match_score or 0),
                    "certification_score": float(evaluation.certification_match_score or 0),
                    "project_score": float(evaluation.project_match_score or 0),
                    "matched_skills": evaluation.matched_skills or [],
                    "missing_skills": evaluation.missing_skills or [],
                    "strengths": evaluation.strengths,
                    "weaknesses": evaluation.weaknesses,
                    "transferable_skills": evaluation.transferable_skills,
                    "evaluation_id": evaluation.id,
                    "evidence": evidence,
                    "skills": candidate.skills or [],
                }
            )
        rows.sort(key=lambda r: r["overall_score"], reverse=True)
        for idx, row in enumerate(rows, start=1):
            row["rank"] = idx
            if blind_mode:
                row["legal_name"] = row.get("legal_name") or row.get("name")
                row["name"] = f"Candidate #{idx}"
        return rows

    def _attach_evidence(
        self,
        db: Session,
        ranked: list[dict[str, Any]],
        blind_mode: bool,
    ) -> list[dict[str, Any]]:
        eval_ids = [row.get("evaluation_id") for row in ranked if row.get("evaluation_id")]
        by_eval: dict[Any, list[Evidence]] = {}
        if eval_ids:
            rows = db.query(Evidence).filter(Evidence.evaluation_id.in_(eval_ids)).all()
            for item in rows:
                by_eval.setdefault(item.evaluation_id, []).append(item)
        attached: list[dict[str, Any]] = []
        for row in ranked:
            items = by_eval.get(row.get("evaluation_id"), [])
            evidence = []
            for item in items:
                snippet = item.resume_text_snippet or ""
                if blind_mode:
                    snippet = redact_identity(snippet, [str(row.get("name") or "")])
                evidence.append(
                    {
                        "id": str(item.id),
                        "skill_name": item.skill_name,
                        "resume_text_snippet": snippet,
                        "source_section": item.source_section,
                        "confidence_score": float(item.confidence_score) if item.confidence_score is not None else None,
                    }
                )
            clone = dict(row)
            clone["evidence"] = evidence
            clone["legal_name"] = row.get("legal_name") or row.get("name")
            if blind_mode:
                clone["name"] = f"Candidate #{clone.get('rank')}"
                clone["email"] = None
            attached.append(clone)
        return attached

    def _synthetic_pool(
        self,
        context_candidates: list[Any],
        job: JobPosting,
        blind_mode: bool,
    ) -> list[dict[str, Any]]:
        """Workflow shortlist when the DB pool is empty (UI demo / no uploads yet)."""
        pool: list[dict[str, Any]] = []
        required = [str(s) for s in (job.required_skills or [])]
        for idx, raw in enumerate(context_candidates, start=1):
            if hasattr(raw, "model_dump"):
                data = raw.model_dump()
            elif isinstance(raw, dict):
                data = raw
            else:
                continue
            name = str(data.get("name") or f"Candidate {idx}")
            skills = [str(s) for s in (data.get("skills") or [])]
            missing = [str(s) for s in (data.get("missing_skills") or data.get("gaps") or [])]
            if not missing and required:
                have = {s.lower() for s in skills}
                missing = [s for s in required if s.lower() not in have]
            cid = data.get("id") or data.get("candidate_id")
            pool.append(
                {
                    "candidate_id": cid if is_uuid(cid) else UUID(int=idx),
                    "name": f"Candidate #{idx}" if blind_mode else name,
                    "email": None,
                    "overall_score": float(data.get("overall_score") or data.get("score") or 0),
                    "skill_score": float(data.get("skill_score") or 0),
                    "experience_score": float(data.get("experience_score") or 0),
                    "education_score": 0,
                    "certification_score": 0,
                    "project_score": 0,
                    "matched_skills": skills,
                    "missing_skills": missing,
                    "strengths": data.get("strengths"),
                    "weaknesses": None,
                    "skills": skills,
                    "rank": int(data.get("rank") or idx),
                    "evidence": [],
                    "synthetic": True,
                }
            )
        pool.sort(key=lambda r: float(r.get("overall_score") or 0), reverse=True)
        for idx, row in enumerate(pool, start=1):
            row["rank"] = idx
        return pool

    @staticmethod
    def _job_context(job: JobPosting, job_title: Optional[str]) -> dict[str, Any]:
        return {
            "id": str(job.id),
            "title": job_title or job.title,
            "required_skills": job.required_skills or [],
            "nice_to_have_skills": job.nice_to_have_skills or [],
            "required_experience_years": job.required_experience_years,
        }

    @staticmethod
    def _history_text(history: list[dict[str, Any]], turns: int = 4) -> str:
        lines: list[str] = []
        for turn in history[-turns:]:
            role = turn.get("role")
            content = str(turn.get("content") or "").strip().replace("\n", " ")
            if role in {"user", "assistant"} and content:
                lines.append(f"{role}: {content[:240]}")
        return "\n".join(lines)

    @staticmethod
    def _prior_candidate_ids(history: list[dict[str, Any]]) -> list[str]:
        for turn in reversed(history):
            if turn.get("role") != "assistant":
                continue
            meta = turn.get("metadata") or {}
            ids = meta.get("candidates_referenced") or []
            if ids:
                return [str(x) for x in ids]
        return []

    @staticmethod
    def _redact_citations(
        citations: list[dict[str, Any]],
        names: Optional[list[str]] = None,
    ) -> list[dict[str, Any]]:
        redacted = []
        for item in citations:
            clone = dict(item)
            clone["snippet"] = redact_identity(str(clone.get("snippet") or ""), names)
            redacted.append(clone)
        return redacted


recruiter_agent = RecruiterCopilot()
