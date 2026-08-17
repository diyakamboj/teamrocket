import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, Query, UploadFile

from app.dependencies import AppStore, RecruiterEmail
from app.models.evaluation import AuditLog, ChatAttachment
from app.models.schemas import (
    AgentAskRequest,
    AgentAskResponse,
    AgentAttachmentResponse,
    AgentModelsResponse,
    AgentSessionResponse,
    AgentStatusResponse,
)
from app.services.attachment_processor import _process_attachment
from app.services.azure_services import blob_service
from app.services.chatbot_client import chatbot_client
from app.services.model_registry import model_registry
from app.services.recruiter_agent import recruiter_agent
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError, ValidationAppError
from app.utils.logger import get_logger
from app.utils.validators import (
    ALLOWED_RESUME_EXTENSIONS,
    MAX_RESUME_SIZE_BYTES,
    is_allowed_resume_filename,
)

router = APIRouter()
logger = get_logger(__name__)


def _log_audit(store: Store, **fields) -> None:
    try:
        store.audit_logs.save(AuditLog(**fields))
    except Exception as exc:
        logger.warning("Failed to persist audit log %s: %s", fields.get("action"), exc)


@router.get("/status", response_model=AgentStatusResponse)
async def agent_status():
    return AgentStatusResponse(
        local_agent=True,
        chatbot=await chatbot_client.health(),
    )


@router.get("/models", response_model=AgentModelsResponse)
def get_models(recruiter_email: RecruiterEmail):
    return AgentModelsResponse(
        models=model_registry.list_for(recruiter_email),
        default_model_id=model_registry.default_model(recruiter_email),
    )


@router.post("", response_model=AgentAskResponse)
@router.post("/", response_model=AgentAskResponse, include_in_schema=False)
@router.post("/ask", response_model=AgentAskResponse, include_in_schema=False)
async def ask_agent(
    payload: AgentAskRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    if payload.model_id and not model_registry.is_authorized(payload.model_id, recruiter_email):
        raise ValidationAppError(
            "Model not available for this recruiter", {"model_id": payload.model_id}
        )

    result = await recruiter_agent.query_candidates(
        store,
        user_query=payload.prompt_text,
        recruiter_email=recruiter_email,
        job_id=payload.job_id,
        session_id=payload.session_id,
        chatbot_conversation_id=payload.chatbot_conversation_id,
        blind_mode=payload.blind_mode,
        weights=payload.weights,
        candidate_id=payload.candidate_id,
        model_id=payload.model_id,
        attachment_ids=payload.attachment_ids,
    )
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="agent_ask",
        resource_type="job",
        resource_id=result.get("job_id"),
        details={
            "session_id": str(result["session_id"]),
            "source": result.get("source"),
            "chatbot_conversation_id": result.get("chatbot_conversation_id"),
            "model_id": result.get("model_id"),
            "candidate_id": str(result["candidate_id"]) if result.get("candidate_id") else None,
        },
    )
    return result



@router.get("/sessions", response_model=list[AgentSessionResponse])
def list_sessions(
    store: AppStore,
    recruiter_email: RecruiterEmail,
    mine_only: bool = Query(True),
    candidate_id: Optional[uuid.UUID] = Query(None),
):
    email = recruiter_email if mine_only else None
    return recruiter_agent.list_sessions(store, recruiter_email=email, candidate_id=candidate_id)


@router.post("/attachments", response_model=AgentAttachmentResponse)
async def upload_attachment(
    background_tasks: BackgroundTasks,
    store: AppStore,
    recruiter_email: RecruiterEmail,
    file: UploadFile = File(...),
    session_id: Optional[uuid.UUID] = Form(None),
):
    filename = file.filename or "attachment"
    if not is_allowed_resume_filename(filename):
        raise ValidationAppError(
            "Unsupported file type",
            {"allowed": sorted(ALLOWED_RESUME_EXTENSIONS)},
        )

    content = await file.read()
    if len(content) > MAX_RESUME_SIZE_BYTES:
        raise ValidationAppError("File exceeds 15MB limit")

    blob_path = blob_service.upload_bytes(
        content,
        filename,
        content_type=file.content_type or "application/octet-stream",
    )

    attachment = ChatAttachment(
        session_id=session_id,
        recruiter_email=recruiter_email,
        filename=filename,
        blob_path=blob_path,
        content_type=file.content_type,
        size_bytes=len(content),
        status="queued",
    )
    store.chat_attachments.save(attachment)

    background_tasks.add_task(_process_attachment, attachment.id)

    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="agent_attachment_upload",
        resource_type="chat_attachment",
        resource_id=attachment.id,
        details={"filename": filename, "session_id": str(session_id) if session_id else None},
    )

    return attachment


@router.get("/attachments/{attachment_id}", response_model=AgentAttachmentResponse)
def get_attachment(attachment_id: uuid.UUID, store: AppStore):
    attachment = store.chat_attachments.get(attachment_id)
    if not attachment:
        raise NotFoundError("Attachment not found", {"attachment_id": str(attachment_id)})
    return attachment
