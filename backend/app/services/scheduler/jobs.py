"""
Scheduled jobs.

Registered by the scheduler at startup.
Each job runs in the async event loop — no threads needed.
"""

import asyncio

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.utils.logger import logger


# ── Job: daily digest ─────────────────────────────────────────────────────────

async def send_daily_digests() -> None:
    """
    Runs every hour on the :00. Checks which users have digest enabled
    and whose digest_time falls within the current UTC hour, then
    triggers a personalised AI-generated briefing for each.
    """
    from datetime import UTC, datetime
    from app.db.supabase import get_supabase_client

    db = await get_supabase_client()
    now_utc = datetime.now(UTC)
    current_hour_str = now_utc.strftime("%H:00")

    logger.info("Daily digest job running", hour=current_hour_str)

    try:
        result = await db.table("user_preferences") \
            .select("user_id, timezone, daily_digest_time, digest_channels") \
            .eq("daily_digest_enabled", True) \
            .execute()

        users = result.data or []
        triggered = 0
        for prefs in users:
            if prefs.get("daily_digest_time", "08:00")[:2] + ":00" == current_hour_str:
                asyncio.create_task(
                    _generate_and_send_digest(db, prefs)
                )
                triggered += 1

        logger.info("Daily digest triggered", count=triggered)
    except Exception as exc:
        logger.error("Daily digest job failed", error=str(exc))


async def _generate_and_send_digest(db, prefs: dict) -> None:
    """Generates and emails a personalised daily briefing for one user."""
    from app.agents.chat_agent import ChatAgent
    from app.agents.memory.manager import MemoryManager
    from app.api.v1.notifications.service import NotificationService
    from app.api.v1.notifications.schemas import SendEmailRequest

    user_id = prefs["user_id"]
    channels = prefs.get("digest_channels", ["gmail", "googlecalendar"])

    try:
        # Fetch user info for email address
        user_result = await db.table("users").select("email, full_name").eq("id", user_id).execute()
        if not user_result.data:
            return
        user = user_result.data[0]

        # Create a temporary agent session for the digest
        memory = MemoryManager(db)
        session = await memory.create_session(
            user_id=user_id,
            title="Daily digest",
        )

        channel_list = ", ".join(channels)
        prompt = (
            f"Generate a concise daily briefing. "
            f"Check {channel_list} and summarise: "
            f"(1) Today's calendar events, "
            f"(2) Important unread emails (if Gmail connected), "
            f"(3) Any urgent tasks or mentions. "
            f"Format as a clean HTML email body. Keep it under 300 words."
        )

        agent = ChatAgent(user_id=user_id, db=db)
        turn = await agent.chat(session_id=session.id, user_message=prompt)

        # Email the digest
        notif = NotificationService(db)
        await notif.send_email(
            SendEmailRequest(
                to=user["email"],
                subject="Your daily briefing",
                template="generic",
                variables={
                    "subject": "Your daily briefing",
                    "body": turn.assistant_response or "Nothing to report today.",
                },
            ),
            triggered_by="scheduler",
        )

        # Also save as in-app notification
        await notif.create_notification(
            user_id=user_id,
            title="Daily briefing ready",
            body=turn.assistant_response[:200] + "…" if len(turn.assistant_response) > 200 else turn.assistant_response,
            type="info",
        )

        logger.info("Daily digest sent", user_id=user_id)
    except Exception as exc:
        logger.error("Failed to generate digest", user_id=user_id, error=str(exc))


# ── Job: token budget alert ───────────────────────────────────────────────────

async def check_token_budgets() -> None:
    """
    Runs once a day. Checks if any user is approaching a high token
    usage threshold and sends a warning notification.
    """
    from app.db.supabase import get_supabase_client
    from app.api.v1.analytics.service import AnalyticsService
    from app.api.v1.notifications.service import NotificationService

    TOKEN_WARN_THRESHOLD = 500_000  # tokens / 30d

    db = await get_supabase_client()
    try:
        users_result = await db.table("users").select("id").execute()
        analytics = AnalyticsService(db)
        notif = NotificationService(db)

        for user in (users_result.data or []):
            user_id = user["id"]
            summary = await analytics.get_usage_summary(user_id=user_id, period="30d")
            total = summary.total_input_tokens + summary.total_output_tokens
            if total > TOKEN_WARN_THRESHOLD:
                await notif.create_notification(
                    user_id=user_id,
                    title="High token usage",
                    body=f"You've used {total:,} tokens this month (~${summary.estimated_cost_usd:.4f}). Consider reviewing usage.",
                    type="warning",
                )
        logger.info("Token budget check complete")
    except Exception as exc:
        logger.error("Token budget check failed", error=str(exc))


# ── Job: clean up expired confirmation requests ───────────────────────────────

async def purge_expired_confirmations() -> None:
    """Runs every 5 minutes — cleans stale tool confirmation requests."""
    from app.agents.tools.confirmation import confirmation_store
    purged = confirmation_store.purge_expired()
    if purged:
        logger.info("Purged expired confirmations", count=purged)


# ── Job: session summarization sweep ─────────────────────────────────────────

async def summarize_long_sessions() -> None:
    """
    Runs every 30 min. Finds sessions with many unsummarized messages
    and triggers background summarization so the agent context stays fresh.
    """
    from app.db.supabase import get_supabase_client
    from app.agents.memory.manager import MemoryManager

    db = await get_supabase_client()
    memory = MemoryManager(db)
    try:
        result = await db.table("agent_sessions").select("id").execute()
        summarized = 0
        for session in (result.data or []):
            was_summarized = await memory.maybe_summarize(session_id=session["id"])
            if was_summarized:
                summarized += 1
        if summarized:
            logger.info("Background summarization", sessions=summarized)
    except Exception as exc:
        logger.error("Background summarization failed", error=str(exc))


# ── Register all jobs ─────────────────────────────────────────────────────────

def register_all_jobs(scheduler: AsyncIOScheduler) -> None:
    # Daily digest — check every hour
    scheduler.add_job(
        send_daily_digests,
        trigger=CronTrigger(minute=0),   # top of every hour
        id="daily_digest",
        name="Send daily digests",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=300,
    )

    # Token budget alerts — once per day at 9 AM UTC
    scheduler.add_job(
        check_token_budgets,
        trigger=CronTrigger(hour=9, minute=0),
        id="token_budget_alert",
        name="Token budget alerts",
        replace_existing=True,
        max_instances=1,
    )

    # Confirmation cleanup — every 5 minutes
    scheduler.add_job(
        purge_expired_confirmations,
        trigger=IntervalTrigger(minutes=5),
        id="purge_confirmations",
        name="Purge expired confirmations",
        replace_existing=True,
        max_instances=1,
    )

    # Background summarization — every 30 minutes
    scheduler.add_job(
        summarize_long_sessions,
        trigger=IntervalTrigger(minutes=30),
        id="session_summarization",
        name="Background session summarization",
        replace_existing=True,
        max_instances=1,
    )

    logger.info(
        "Jobs registered",
        jobs=["daily_digest", "token_budget_alert", "purge_confirmations", "session_summarization"],
    )
