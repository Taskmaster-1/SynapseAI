from datetime import datetime
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel


class CheckoutRequest(BaseModel):
    price_id: str
    success_url: AnyHttpUrl
    cancel_url: AnyHttpUrl


class CheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str


class CustomerPortalResponse(BaseModel):
    portal_url: str


class SubscriptionResponse(BaseModel):
    status: Literal["free", "active", "trialing", "past_due", "canceled", "unpaid"]
    plan: str | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False
    stripe_customer_id: str | None = None
