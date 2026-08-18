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
        for err in exc.errors():
            ctx = err.get("ctx") or {}
            safe_ctx = {
                key: value if isinstance(value, (str, int, float, bool, type(None))) else str(value)
                for key, value in ctx.items()
            }
            errors.append(
                {
                    "type": err.get("type"),
                    "loc": err.get("loc"),
                    "msg": err.get("msg"),
                    "input": err.get("input"),
                    "ctx": safe_ctx,
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
