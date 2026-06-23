from typing import Literal
from pydantic import BaseModel, Field


class UserPreferences(BaseModel):
    user_id: str
    agent_instructions: str | None = Field(default=None, max_length=2000)
    agent_tone: Literal["professional", "casual", "concise", "detailed"] = "professional"
    auto_execute_safe_tools: bool = True
    confirm_before_send: bool = True
    timezone: str = "UTC"
    work_start_hour: int = Field(default=9, ge=0, le=23)
    work_end_hour: int = Field(default=18, ge=0, le=23)
    work_days: list[int] = Field(default=[0, 1, 2, 3, 4])
    daily_digest_enabled: bool = False
    daily_digest_time: str = "08:00"
    digest_channels: list[str] = Field(default=["gmail", "googlecalendar"])
    email_notifications: bool = True
    language: str = "en"
    response_language: str | None = None


class UpdatePreferencesRequest(BaseModel):
    agent_instructions: str | None = Field(default=None, max_length=2000)
    agent_tone: Literal["professional", "casual", "concise", "detailed"] | None = None
    auto_execute_safe_tools: bool | None = None
    confirm_before_send: bool | None = None
    timezone: str | None = None
    work_start_hour: int | None = Field(default=None, ge=0, le=23)
    work_end_hour: int | None = Field(default=None, ge=0, le=23)
    work_days: list[int] | None = None
    daily_digest_enabled: bool | None = None
    daily_digest_time: str | None = None
    digest_channels: list[str] | None = None
    email_notifications: bool | None = None
    language: str | None = None
    response_language: str | None = None
