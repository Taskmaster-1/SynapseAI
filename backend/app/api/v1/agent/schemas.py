from datetime import datetime
from typing import Any

from composio.client.enums import App
from pydantic import BaseModel, Field


# ── Requests ──────────────────────────────────────────────────────────────────

class NewSessionRequest(BaseModel):
    title: str | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=32_000)
    session_id: str | None = None      # if None, creates a new session


class ConnectAppRequest(BaseModel):
    app: str  # e.g. "gmail", "slack"


class DisconnectAppRequest(BaseModel):
    app: str  # e.g. "gmail", "slack"


# ── Responses ─────────────────────────────────────────────────────────────────

class SessionResponse(BaseModel):
    id: str
    user_id: str
    title: str | None
    created_at: datetime | None
    updated_at: datetime | None


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]


class MessageResponse(BaseModel):
    id: str | None
    role: str
    content: str
    tool_name: str | None = None
    created_at: datetime | None = None


class HistoryResponse(BaseModel):
    session_id: str
    messages: list[MessageResponse]
    total: int
    has_summary: bool


class ToolCallLog(BaseModel):
    name: str
    params: dict[str, Any]
    success: bool
    error: str | None = None


class ChatResponse(BaseModel):
    session_id: str
    response: str
    tool_calls: list[ToolCallLog] = []
    iterations: int = 0


class ConnectedAppsResponse(BaseModel):
    connected: list[str]
    available: list[str]


class ConnectAppResponse(BaseModel):
    app: str
    auth_url: str
    message: str = "Visit auth_url to connect this app"
