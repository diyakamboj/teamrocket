from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.middleware import RequestContextMiddleware
from app.routes import (
    agent,
    candidates,
    dashboard,
    evaluation,
    fraud,
    handoff,
    internal_marketplace,
    interviews,
    jobs,
    ops,
    readiness,
    resumes,
    screening,
)
from app.utils.error_handlers import setup_exception_handlers
from app.utils.logger import get_logger, setup_logging

setup_logging()
logger = get_logger(__name__)


app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
)

# Azure Monitor / Application Insights — a no-op when unset (the default,
# and the only state reachable in local mock-mode dev). The Ops dashboard's
# own sre_events telemetry (below) works independently of this.
if settings.APPLICATIONINSIGHTS_CONNECTION_STRING:
    from azure.monitor.opentelemetry import configure_azure_monitor
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

    configure_azure_monitor(connection_string=settings.APPLICATIONINSIGHTS_CONNECTION_STRING)
    FastAPIInstrumentor.instrument_app(app)
    HTTPXClientInstrumentor().instrument()
    logger.info("Azure Monitor OpenTelemetry configured")
else:
    logger.info("APPLICATIONINSIGHTS_CONNECTION_STRING not set — Azure Monitor telemetry disabled")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Added after CORS so it wraps outermost (Starlette's add_middleware inserts
# at the front of its internal list, so the most recently added middleware
# ends up outermost) — gives it timing coverage of the full request.
app.add_middleware(RequestContextMiddleware)

setup_exception_handlers(app)

app.include_router(resumes.router, prefix="/api/resumes", tags=["Resumes"])
app.include_router(jobs.router, prefix="/api/jobs", tags=["Jobs"])
app.include_router(candidates.router, prefix="/api/candidates", tags=["Candidates"])
app.include_router(evaluation.router, prefix="/api/evaluation", tags=["Evaluation"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(agent.router, prefix="/api/agent", tags=["AI Agent"])
app.include_router(fraud.router, prefix="/api/fraud", tags=["Fraud Detection"])
app.include_router(handoff.router, prefix="/api/handoff", tags=["Interview Handoff"])
app.include_router(interviews.router, prefix="/api/interviews", tags=["Interviews"])
app.include_router(screening.router, prefix="/api/screening", tags=["Preliminary Screening"])
app.include_router(readiness.router, prefix="/api/readiness", tags=["Readiness & Assessment"])
app.include_router(
    internal_marketplace.router,
    prefix="/api/internal-marketplace",
    tags=["Internal Talent Marketplace"],
)
app.include_router(ops.router, prefix="/api/ops", tags=["Ops / SRE Dashboard"])





@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "version": settings.API_VERSION,
        "mock_azure": settings.USE_MOCK_AZURE,
        "azure_configured": settings.azure_configured,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=settings.DEBUG)
