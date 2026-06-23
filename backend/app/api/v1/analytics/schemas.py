from datetime import datetime
from pydantic import BaseModel


class UsageSummary(BaseModel):
    user_id: str
    period: str                  # "today" | "7d" | "30d" | "all"
    total_messages: int
    total_agent_turns: int
    total_input_tokens: int
    total_output_tokens: int
    estimated_cost_usd: float
    tool_call_count: int
    most_used_tools: list[dict]  # [{"name": "GMAIL_FETCH_EMAILS", "count": 12}]
    ai_provider_breakdown: dict  # {"gemini": 80, "groq": 20}


class ToolCallLog(BaseModel):
    id: str
    session_id: str
    tool_name: str
    success: bool
    error: str | None
    duration_ms: int | None
    created_at: datetime


class ToolCallLogsResponse(BaseModel):
    logs: list[ToolCallLog]
    total: int


class DailyUsage(BaseModel):
    date: str
    messages: int
    tokens: int
    tool_calls: int
    cost_usd: float


class UsageTimelineResponse(BaseModel):
    user_id: str
    days: list[DailyUsage]
