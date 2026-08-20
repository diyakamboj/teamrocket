import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class AppError(Exception):
    def __init__(self, message: str, status_code: int = 400, details: dict | None = None):
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)


class NotFoundError(AppError):
    def __init__(self, message: str = "Resource not found", details: dict | None = None):
        super().__init__(message=message, status_code=404, details=details)


class ValidationAppError(AppError):
    def __init__(self, message: str = "Validation error", details: dict | None = None):
        super().__init__(message=message, status_code=422, details=details)


class UnauthorizedError(AppError):
    def __init__(self, message: str = "Not signed in") -> None:
        super().__init__(message=message, status_code=401)

class ForbiddenError(AppError):
    """Authenticated, but not allowed to do this."""

    def __init__(self, message: str = "Not permitted", details: dict | None = None):
        super().__init__(message=message, status_code=403, details=details)


class AzureServiceError(AppError):
    def __init__(self, message: str = "Azure service error", details: dict | None = None):
        super().__init__(message=message, status_code=502, details=details)


def setup_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
        logger.warning("AppError: %s | %s", exc.message, exc.details)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.message, "details": exc.details},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.detail, "details": {}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = []
        def _jsonable(value: object) -> object:
            """Pydantic puts the offending value straight into the error. For a
            body that failed to parse at all that value is the raw `bytes`,
            which json.dumps() cannot encode — serializing it unguarded turned
            every malformed request into a 500 instead of a 422."""
            if isinstance(value, (str, int, float, bool, type(None))):
                return value
            if isinstance(value, bytes):
                return value.decode("utf-8", errors="replace")
            if isinstance(value, (list, tuple)):
                return [_jsonable(item) for item in value]
            if isinstance(value, dict):
                return {str(k): _jsonable(v) for k, v in value.items()}
            return str(value)

        for err in exc.errors():
            ctx = err.get("ctx") or {}
            errors.append(
                {
                    "type": err.get("type"),
                    "loc": _jsonable(err.get("loc")),
                    "msg": err.get("msg"),
                    "input": _jsonable(err.get("input")),
                    "ctx": {str(key): _jsonable(value) for key, value in ctx.items()},
                }
            )
        return JSONResponse(
            status_code=422,
            content={"error": "Validation error", "details": {"errors": errors}},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"error": "Internal server error", "details": {}},
        )
