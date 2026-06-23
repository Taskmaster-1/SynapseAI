from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class MessageRole(str):
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"
    SYSTEM = "system"


class ChatMessage(BaseModel):
    id: str | None = None
    session_id: str
    role: Literal["user", "assistant", "tool", "system"]
    content: str
    tool_name: str | None = None       # populated when role == "tool"
    tool_call_id: str | None = None    # links tool result back to tool call
    tokens: int = 0
    created_at: datetime | None = None


class ConversationSummary(BaseModel):
    id: str | None = None
    session_id: str
    summary: str
    message_count: int             # how many messages this summary covers
    up_to_message_id: str          # last message included in this summary
    created_at: datetime | None = None


class AgentSession(BaseModel):
    id: str
    user_id: str
    title: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MemoryContext(BaseModel):
    """Everything the agent needs from memory for one turn."""
    session_id: str
    summary: str | None = None          # AI-written summary of old history
    recent_messages: list[ChatMessage]  # last N messages (sliding window)
    total_message_count: int = 0
