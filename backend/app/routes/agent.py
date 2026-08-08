from fastapi import APIRouter, Query

from app.dependencies import DbSession, RecruiterEmail
from app.models.evaluation import AuditLog
from app.models.schemas import (
    AgentAskRequest,
    AgentAskResponse,
    AgentSessionResponse,
    AgentStatusResponse,
)
from app.services.chatbot_client import chatbot_client
from app.services.recruiter_agent import recruiter_agent

router = APIRouter()


@router.get("/status", response_model=AgentStatusResponse)
async def agent_status():
    return AgentStatusResponse(
        local_agent=True,
        chatbot=await chatbot_client.health(),
    )


@router.post("/ask", response_model=AgentAskResponse)
async def ask_agent(
    payload: AgentAskRequest,
    db: DbSession,
    recruiter_email: RecruiterEmail,
):
    result = await recruiter_agent.query_candidates(
        db,
        user_query=payload.query,
        recruiter_email=recruiter_email,
        job_id=payload.job_id,
        session_id=payload.session_id,
        chatbot_conversation_id=payload.chatbot_conversation_id,
    )
    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="agent_ask",
            resource_type="job",
            resource_id=result.get("job_id"),
            details={
                "session_id": str(result["session_id"]),
                "source": result.get("source"),
                "chatbot_conversation_id": result.get("chatbot_conversation_id"),
            },
        )
    )
    db.commit()
    return result


@router.get("/sessions", response_model=list[AgentSessionResponse])
def list_sessions(
    db: DbSession,
    recruiter_email: RecruiterEmail,
    mine_only: bool = Query(True),
):
    email = recruiter_email if mine_only else None
    return recruiter_agent.list_sessions(db, recruiter_email=email)
