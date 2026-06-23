from typing import Literal

from pydantic import BaseModel, Field


class MessageSchema(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    messages: list[MessageSchema] = Field(min_length=1)
    system_prompt: str | None = None
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=1024, ge=1, le=8192)
    provider: Literal["gemini", "groq"] | None = None  # force a specific provider


class ChatResponse(BaseModel):
    content: str
    model: str
    provider: str
    input_tokens: int
    output_tokens: int


class HealthResponse(BaseModel):
    providers: dict[str, bool]
