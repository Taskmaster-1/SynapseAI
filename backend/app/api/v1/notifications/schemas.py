from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr


class NotificationSchema(BaseModel):
    id: str
    user_id: str
    title: str
    body: str
    type: Literal["info", "success", "warning", "error"] = "info"
    is_read: bool = False
    created_at: datetime


class NotificationListResponse(BaseModel):
    notifications: list[NotificationSchema]
    unread_count: int = 0

    def model_post_init(self, __context) -> None:
        self.unread_count = sum(1 for n in self.notifications if not n.is_read)


class SendEmailRequest(BaseModel):
    to: EmailStr
    subject: str
    template: Literal["welcome", "password_reset", "subscription_confirmed", "generic"]
    variables: dict = {}


class SendEmailResponse(BaseModel):
    message_id: str
    status: str = "queued"
