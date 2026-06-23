from fastapi import APIRouter
from pydantic import BaseModel

from app.agents.tools.confirmation import confirmation_store
from app.core.dependencies import CurrentUserDep
from app.core.exceptions import NotFoundException

router = APIRouter(prefix="/confirmations", tags=["Agent Confirmations"])


class ConfirmationResponse(BaseModel):
    id: str
    action_name: str
    human_summary: str
    status: str  # "pending" | "approved" | "rejected" | "expired"


class ActionResponse(BaseModel):
    id: str
    status: str
    message: str


@router.get("/{confirmation_id}", response_model=ConfirmationResponse)
async def get_confirmation(confirmation_id: str, current_user: CurrentUserDep):
    """Get details of a pending confirmation request."""
    conf = confirmation_store.get(confirmation_id)
    if not conf:
        raise NotFoundException("Confirmation")

    if conf.approved is None:
        status = "pending"
    elif conf.approved:
        status = "approved"
    else:
        status = "rejected"

    return ConfirmationResponse(
        id=conf.id,
        action_name=conf.action_name,
        human_summary=conf.human_summary,
        status=status,
    )


@router.post("/{confirmation_id}/approve", response_model=ActionResponse)
async def approve_confirmation(confirmation_id: str, current_user: CurrentUserDep):
    """Approve a pending tool action. The agent will execute it immediately."""
    conf = confirmation_store.approve(confirmation_id)
    if not conf:
        raise NotFoundException("Confirmation (may have expired)")
    return ActionResponse(id=conf.id, status="approved", message="Action approved and will execute now")


@router.post("/{confirmation_id}/reject", response_model=ActionResponse)
async def reject_confirmation(confirmation_id: str, current_user: CurrentUserDep):
    """Reject a pending tool action. The agent will skip it and ask for guidance."""
    conf = confirmation_store.reject(confirmation_id)
    if not conf:
        raise NotFoundException("Confirmation (may have expired)")
    return ActionResponse(id=conf.id, status="rejected", message="Action rejected")
