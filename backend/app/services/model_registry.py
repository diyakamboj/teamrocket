"""Server-enforced model selection + a pragmatic email allowlist.

The app has no real auth system — this is a documented, known limitation,
not real RBAC. `ModelRegistry` is the single source of truth for which
model ids exist, which Azure deployment backs each one, and which
recruiter emails may use a given (restricted) model.
"""

from __future__ import annotations

from app.config import settings


class ModelRegistry:
    def __init__(self) -> None:
        self._models: list[dict] = list(settings.COPILOT_MODEL_REGISTRY)
        self._deployments: dict[str, str] = dict(settings.COPILOT_MODEL_DEPLOYMENTS)
        self._allowlist: dict[str, list[str]] = dict(settings.COPILOT_MODEL_ALLOWLIST)
        self._default_model_id: str = settings.COPILOT_DEFAULT_MODEL

    def _all_ids(self) -> list[str]:
        return [str(m["id"]) for m in self._models]

    def is_authorized(self, model_id: str, email: str) -> bool:
        if model_id not in self._all_ids():
            return False
        allowed_emails = self._allowlist.get(model_id)
        if not allowed_emails:
            return True
        return email in allowed_emails

    def list_for(self, email: str) -> list[dict]:
        return [m for m in self._models if self.is_authorized(str(m["id"]), email)]

    def default_model(self, email: str) -> str:
        if self.is_authorized(self._default_model_id, email):
            return self._default_model_id
        available = self.list_for(email)
        if available:
            return str(available[0]["id"])
        return self._default_model_id

    def resolve(self, model_id: str | None, email: str) -> str:
        """Silently downgrade an unknown/unset/unauthorized-by-omission id to
        the recruiter's default — this is the "unset or unknown" path.
        Explicitly *disallowed* ids are rejected earlier, at the route layer
        (`ValidationAppError`), before this is ever called.
        """
        if model_id and self.is_authorized(model_id, email):
            return model_id
        return self.default_model(email)

    def deployment_for(self, model_id: str) -> str:
        return self._deployments.get(model_id) or settings.AZURE_OPENAI_DEPLOYMENT_NAME


model_registry = ModelRegistry()
