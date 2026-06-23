import smtplib
import uuid
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.api.v1.notifications.schemas import (
    NotificationListResponse,
    NotificationSchema,
    SendEmailRequest,
    SendEmailResponse,
)
from app.core.config import settings
from app.core.exceptions import NotFoundException
from app.utils.logger import logger
from supabase import AsyncClient

# ── Email Templates ────────────────────────────────────────────────────────────

EMAIL_TEMPLATES: dict[str, tuple[str, str]] = {
    "welcome": (
        "Welcome to {app_name}!",
        "<h1>Welcome, {name}!</h1><p>Your account is ready. Let's get started.</p>",
    ),
    "password_reset": (
        "Reset your password",
        "<h1>Password Reset</h1><p>Click <a href='{reset_link}'>here</a> to reset your password. Expires in 1 hour.</p>",
    ),
    "subscription_confirmed": (
        "Subscription confirmed 🎉",
        "<h1>You're subscribed!</h1><p>Your <strong>{plan}</strong> plan is now active.</p>",
    ),
    "generic": (
        "{subject}",
        "<p>{body}</p>",
    ),
}


class NotificationService:
    def __init__(self, db: AsyncClient) -> None:
        self._db = db

    # ── In-App Notifications ──────────────────────────────────────────────

    async def list_for_user(self, *, user_id: str) -> NotificationListResponse:
        result = await self._db.table("notifications") \
            .select("*") \
            .eq("user_id", user_id) \
            .order("created_at", desc=True) \
            .limit(50) \
            .execute()

        notifications = [NotificationSchema(**row) for row in (result.data or [])]
        return NotificationListResponse(notifications=notifications)

    async def mark_read(self, *, notification_id: str, user_id: str) -> None:
        result = await self._db.table("notifications") \
            .select("id") \
            .eq("id", notification_id) \
            .eq("user_id", user_id) \
            .execute()

        if not result.data:
            raise NotFoundException("Notification")

        await self._db.table("notifications") \
            .update({"is_read": True}) \
            .eq("id", notification_id) \
            .execute()

    async def mark_all_read(self, *, user_id: str) -> None:
        await self._db.table("notifications") \
            .update({"is_read": True}) \
            .eq("user_id", user_id) \
            .eq("is_read", False) \
            .execute()

    async def create_notification(
        self,
        *,
        user_id: str,
        title: str,
        body: str,
        type: str = "info",
    ) -> None:
        """Internal helper to push an in-app notification."""
        await self._db.table("notifications").insert({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "title": title,
            "body": body,
            "type": type,
            "is_read": False,
        }).execute()

    # ── Email ─────────────────────────────────────────────────────────────

    async def send_email(
        self,
        payload: SendEmailRequest,
        *,
        triggered_by: str,
    ) -> SendEmailResponse:
        subject_tpl, body_tpl = EMAIL_TEMPLATES.get(
            payload.template, EMAIL_TEMPLATES["generic"]
        )
        subject = subject_tpl.format(**payload.variables, subject=payload.subject)
        body_html = body_tpl.format(**payload.variables, app_name=settings.APP_NAME)

        message_id = str(uuid.uuid4())
        self._send_smtp(to=payload.to, subject=subject, html_body=body_html)

        logger.info(
            "Email sent",
            to=payload.to,
            template=payload.template,
            triggered_by=triggered_by,
            message_id=message_id,
        )
        return SendEmailResponse(message_id=message_id, status="sent")

    def _send_smtp(self, *, to: str, subject: str, html_body: str) -> None:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>"
        msg["To"] = to
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.EMAIL_FROM, to, msg.as_string())
