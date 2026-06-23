from datetime import UTC, datetime

import stripe
from stripe import SignatureVerificationError as WebhookSignatureVerificationError

from app.api.v1.payments.schemas import (
    CheckoutResponse,
    CustomerPortalResponse,
    SubscriptionResponse,
)
from app.core.config import settings
from app.core.exceptions import PaymentException
from app.utils.logger import logger
from supabase import AsyncClient

stripe.api_key = settings.STRIPE_SECRET_KEY

# Map Stripe status → our internal subscription_status
STRIPE_STATUS_MAP = {
    "active": "active",
    "trialing": "trialing",
    "past_due": "past_due",
    "canceled": "canceled",
    "unpaid": "unpaid",
    "incomplete": "past_due",
    "incomplete_expired": "canceled",
}


class PaymentService:
    def __init__(self, db: AsyncClient) -> None:
        self._db = db

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _get_or_create_stripe_customer(self, user: dict) -> str:
        if user.get("stripe_customer_id"):
            return user["stripe_customer_id"]

        customer = stripe.Customer.create(
            email=user["email"],
            name=user.get("full_name"),
            metadata={"user_id": user["id"]},
        )
        await self._db.table("users").update(
            {"stripe_customer_id": customer.id}
        ).eq("id", user["id"]).execute()

        logger.info("Stripe customer created", user_id=user["id"], customer_id=customer.id)
        return customer.id

    # ── Public API ────────────────────────────────────────────────────────

    async def create_checkout_session(
        self,
        *,
        user: dict,
        price_id: str,
        success_url: str,
        cancel_url: str,
    ) -> CheckoutResponse:
        try:
            customer_id = await self._get_or_create_stripe_customer(user)
            session = stripe.checkout.Session.create(
                customer=customer_id,
                mode="subscription",
                line_items=[{"price": price_id, "quantity": 1}],
                success_url=str(success_url),
                cancel_url=str(cancel_url),
                metadata={"user_id": user["id"]},
                subscription_data={"trial_period_days": 14},
            )
            return CheckoutResponse(checkout_url=session.url, session_id=session.id)
        except stripe.StripeError as e:
            logger.error("Stripe checkout error", error=str(e))
            raise PaymentException(str(e.user_message or e))

    async def get_subscription(self, *, user_id: str) -> SubscriptionResponse:
        result = await self._db.table("users").select(
            "subscription_status, stripe_customer_id, stripe_subscription_id, subscription_plan, subscription_period_end"
        ).eq("id", user_id).execute()

        if not result.data:
            return SubscriptionResponse(status="free")

        row = result.data[0]
        period_end = row.get("subscription_period_end")

        return SubscriptionResponse(
            status=row.get("subscription_status", "free"),
            plan=row.get("subscription_plan"),
            current_period_end=datetime.fromisoformat(period_end) if period_end else None,
            stripe_customer_id=row.get("stripe_customer_id"),
        )

    async def create_portal_session(self, *, user: dict) -> CustomerPortalResponse:
        customer_id = await self._get_or_create_stripe_customer(user)
        try:
            session = stripe.billing_portal.Session.create(customer=customer_id)
            return CustomerPortalResponse(portal_url=session.url)
        except stripe.StripeError as e:
            raise PaymentException(str(e.user_message or e))

    # ── Webhook ───────────────────────────────────────────────────────────

    async def handle_webhook(self, raw_body: bytes, signature: str) -> None:
        try:
            event = stripe.Webhook.construct_event(
                raw_body, signature, settings.STRIPE_WEBHOOK_SECRET
            )
        except WebhookSignatureVerificationError:
            raise PaymentException("Invalid webhook signature")

        event_type = event["type"]
        logger.info("Stripe webhook received", event_type=event_type)

        handlers = {
            "checkout.session.completed": self._on_checkout_completed,
            "customer.subscription.updated": self._on_subscription_updated,
            "customer.subscription.deleted": self._on_subscription_deleted,
            "invoice.payment_failed": self._on_payment_failed,
        }

        handler = handlers.get(event_type)
        if handler:
            await handler(event["data"]["object"])

    async def _on_checkout_completed(self, session: dict) -> None:
        user_id = session.get("metadata", {}).get("user_id")
        subscription_id = session.get("subscription")
        if not user_id or not subscription_id:
            return

        sub = stripe.Subscription.retrieve(subscription_id)
        await self._sync_subscription(user_id, sub)

    async def _on_subscription_updated(self, subscription: dict) -> None:
        customer_id = subscription["customer"]
        result = await self._db.table("users").select("id").eq("stripe_customer_id", customer_id).execute()
        if result.data:
            await self._sync_subscription(result.data[0]["id"], subscription)

    async def _on_subscription_deleted(self, subscription: dict) -> None:
        customer_id = subscription["customer"]
        result = await self._db.table("users").select("id").eq("stripe_customer_id", customer_id).execute()
        if result.data:
            await self._db.table("users").update({
                "subscription_status": "canceled",
                "stripe_subscription_id": None,
            }).eq("id", result.data[0]["id"]).execute()

    async def _on_payment_failed(self, invoice: dict) -> None:
        customer_id = invoice["customer"]
        result = await self._db.table("users").select("id").eq("stripe_customer_id", customer_id).execute()
        if result.data:
            await self._db.table("users").update(
                {"subscription_status": "past_due"}
            ).eq("id", result.data[0]["id"]).execute()

    async def _sync_subscription(self, user_id: str, sub: dict) -> None:
        period_end = datetime.fromtimestamp(sub["current_period_end"], tz=UTC).isoformat()
        plan = sub["items"]["data"][0]["price"]["nickname"] if sub.get("items") else None

        await self._db.table("users").update({
            "subscription_status": STRIPE_STATUS_MAP.get(sub["status"], sub["status"]),
            "stripe_subscription_id": sub["id"],
            "subscription_plan": plan,
            "subscription_period_end": period_end,
        }).eq("id", user_id).execute()

        logger.info("Subscription synced", user_id=user_id, status=sub["status"])
