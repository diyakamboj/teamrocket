from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
