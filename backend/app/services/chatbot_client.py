"""Client for the Chat-with-Your-Data accelerator (RAG chatbot service)."""

from typing import Any, Optional

import httpx

from app.config import settings
from app.utils.logger import get_logger

logger = get_logger(__name__)


class ChatbotClient:
    """Talks to chat-with-your-data-solution-accelerator FastAPI backend."""

    def __init__(self) -> None:
        self.base_url = (settings.CHATBOT_API_URL or "").rstrip("/")
        self.timeout = settings.CHATBOT_TIMEOUT_SECONDS

    @property
    def enabled(self) -> bool:
        return bool(settings.CHATBOT_ENABLED and self.base_url)

    async def health(self) -> dict[str, Any]:
        if not self.enabled:
            return {"enabled": False, "reachable": False, "url": self.base_url or None}
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/health")
                return {
                    "enabled": True,
                    "reachable": response.status_code < 500,
                    "status_code": response.status_code,
                    "url": self.base_url,
                }
        except Exception as exc:
            logger.warning("Chatbot health check failed: %s", exc)
            return {
                "enabled": True,
                "reachable": False,
                "url": self.base_url,
                "error": str(exc),
            }

    async def ask(
        self,
        *,
        messages: list[dict[str, str]],
        conversation_id: Optional[str] = None,
        user_id: str = "recruiter-anonymous",
    ) -> dict[str, Any]:
        """
        Call POST /api/conversation on the CWYD backend (non-streaming JSON).

        Returns: {content, citations, conversation_id}
        """
        if not self.enabled:
            raise RuntimeError("Chatbot integration is disabled")

        payload: dict[str, Any] = {"messages": messages}
        if conversation_id:
            payload["conversation_id"] = conversation_id

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-ms-client-principal-id": user_id,
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/conversation",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()
            return {
                "content": data.get("content") or "",
                "citations": data.get("citations") or [],
                "conversation_id": data.get("conversation_id"),
            }


chatbot_client = ChatbotClient()
