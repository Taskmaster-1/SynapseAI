from fastapi import APIRouter, Header, Request, status

from app.api.v1.payments.schemas import (
    CheckoutRequest,
    CheckoutResponse,
    CustomerPortalResponse,
    SubscriptionResponse,
)
from app.api.v1.payments.service import PaymentService
from app.core.dependencies import CurrentUserDep, DBDep

router = APIRouter(prefix="/payments", tags=["Payments"])


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(payload: CheckoutRequest, current_user: CurrentUserDep, db: DBDep):
    """Create a Stripe Checkout session for a new subscription."""
    return await PaymentService(db).create_checkout_session(
        user=current_user,
        price_id=payload.price_id,
        success_url=payload.success_url,
        cancel_url=payload.cancel_url,
    )


@router.get("/subscription", response_model=SubscriptionResponse)
async def get_subscription(current_user: CurrentUserDep, db: DBDep):
    """Get the current user's subscription status."""
    return await PaymentService(db).get_subscription(user_id=current_user["id"])


@router.post("/portal", response_model=CustomerPortalResponse)
async def customer_portal(current_user: CurrentUserDep, db: DBDep):
    """Create a Stripe Customer Portal link for managing billing."""
    return await PaymentService(db).create_portal_session(user=current_user)


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def stripe_webhook(
    request: Request,
    db: DBDep,
    stripe_signature: str = Header(..., alias="stripe-signature"),
):
    """Handle incoming Stripe webhook events."""
    raw_body = await request.body()
    await PaymentService(db).handle_webhook(raw_body, stripe_signature)
    return {"received": True}
