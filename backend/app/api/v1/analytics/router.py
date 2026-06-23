from typing import Literal
from fastapi import APIRouter, Query

from app.api.v1.analytics.schemas import (
    ToolCallLogsResponse,
    UsageSummary,
    UsageTimelineResponse,
)
from app.api.v1.analytics.service import AnalyticsService
from app.core.dependencies import CurrentUserDep, DBDep

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/usage", response_model=UsageSummary)
async def get_usage_summary(
    current_user: CurrentUserDep,
    db: DBDep,
    period: Literal["today", "7d", "30d", "all"] = Query(default="30d"),
):
    """Get token usage, tool call counts, costs, and AI provider breakdown."""
    return await AnalyticsService(db).get_usage_summary(
        user_id=current_user["id"], period=period
    )


@router.get("/timeline", response_model=UsageTimelineResponse)
async def get_usage_timeline(
    current_user: CurrentUserDep,
    db: DBDep,
    days: int = Query(default=30, ge=1, le=90),
):
    """Daily usage breakdown — messages, tokens, tool calls, and cost per day."""
    return await AnalyticsService(db).get_usage_timeline(
        user_id=current_user["id"], days=days
    )


@router.get("/tool-logs", response_model=ToolCallLogsResponse)
async def get_tool_logs(
    current_user: CurrentUserDep,
    db: DBDep,
    limit: int = Query(default=50, ge=1, le=200),
    session_id: str | None = Query(default=None),
):
    """Recent tool call logs — useful for debugging and auditing."""
    return await AnalyticsService(db).get_tool_logs(
        user_id=current_user["id"], limit=limit, session_id=session_id
    )
