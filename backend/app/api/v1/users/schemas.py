from datetime import datetime
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, EmailStr


class UserResponse(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    avatar_url: str | None = None
    subscription_status: Literal["free", "active", "trialing", "past_due", "canceled"] = "free"
    subscription_plan: str | None = None
    created_at: datetime | None = None


class UpdateProfileRequest(BaseModel):
    full_name: str | None = None
    avatar_url: AnyHttpUrl | None = None
