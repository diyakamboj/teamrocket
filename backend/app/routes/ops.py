from typing import Optional

from fastapi import APIRouter, Query

from app.models.schemas import (
    OpsAgentHealthResponse,
    OpsAiServiceHealthResponse,
    OpsEndpointBreakdownResponse,
    OpsLogsResponse,
    OpsOverviewResponse,
    OpsRequestHealthResponse,
)
from app.services.sre_metrics_service import sre_metrics

router = APIRouter()

HoursQuery = Query(default=1, ge=1, le=24)


@router.get("/overview", response_model=OpsOverviewResponse)
def overview(hours: int = HoursQuery):
    return sre_metrics.get_overview(hours)


@router.get("/requests", response_model=OpsRequestHealthResponse)
def requests_health(hours: int = HoursQuery):
    return sre_metrics.get_request_health(hours)


@router.get("/ai-services", response_model=OpsAiServiceHealthResponse)
def ai_services_health(hours: int = HoursQuery):
    return sre_metrics.get_ai_service_health(hours)


@router.get("/agent", response_model=OpsAgentHealthResponse)
def agent_health(hours: int = HoursQuery):
    return sre_metrics.get_agent_health(hours)


@router.get("/endpoints", response_model=OpsEndpointBreakdownResponse)
def endpoint_breakdown(hours: int = HoursQuery, limit: int = Query(default=20, ge=1, le=100)):
    return sre_metrics.get_endpoint_breakdown(hours, limit=limit)


@router.get("/logs", response_model=OpsLogsResponse)
def logs(
    hours: int = HoursQuery,
    status: Optional[str] = Query(default=None, description="success | failure | fallback"),
    limit: int = Query(default=200, ge=1, le=500),
):
    return sre_metrics.get_recent_logs(hours, status=status, limit=limit)
