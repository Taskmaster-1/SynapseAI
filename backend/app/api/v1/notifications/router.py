from fastapi import APIRouter, status

from app.api.v1.notifications.schemas import (
    NotificationListResponse,
    SendEmailRequest,
    SendEmailResponse,
)
from app.api.v1.notifications.service import NotificationService
from app.core.dependencies import CurrentUserDep, DBDep

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("/", response_model=NotificationListResponse)
async def list_notifications(current_user: CurrentUserDep, db: DBDep):
    """List in-app notifications for the current user."""
    return await NotificationService(db).list_for_user(user_id=current_user["id"])


@router.patch("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_as_read(notification_id: str, current_user: CurrentUserDep, db: DBDep):
    """Mark a single notification as read."""
    await NotificationService(db).mark_read(
        notification_id=notification_id,
        user_id=current_user["id"],
    )


@router.patch("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(current_user: CurrentUserDep, db: DBDep):
    """Mark all notifications as read."""
    await NotificationService(db).mark_all_read(user_id=current_user["id"])


@router.post("/email/send", response_model=SendEmailResponse, status_code=status.HTTP_202_ACCEPTED)
async def send_email(payload: SendEmailRequest, current_user: CurrentUserDep, db: DBDep):
    """Send a transactional email (admin / trigger use case)."""
    return await NotificationService(db).send_email(payload, triggered_by=current_user["id"])
