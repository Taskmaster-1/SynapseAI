from datetime import UTC, datetime, timedelta

from app.api.v1.analytics.schemas import (
    DailyUsage,
    ToolCallLog,
    ToolCallLogsResponse,
    UsageSummary,
    UsageTimelineResponse,
)
from supabase import AsyncClient

# Rough pricing per 1M tokens (Gemini 1.5 Pro as baseline)
INPUT_TOKEN_COST_PER_M  = 3.50
OUTPUT_TOKEN_COST_PER_M = 10.50

PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30, "all": 3650}


def _cost(input_tokens: int, output_tokens: int) -> float:
    return round(
        (input_tokens / 1_000_000) * INPUT_TOKEN_COST_PER_M
        + (output_tokens / 1_000_000) * OUTPUT_TOKEN_COST_PER_M,
        6,
    )


class AnalyticsService:
    def __init__(self, db: AsyncClient) -> None:
        self._db = db

    async def get_usage_summary(self, *, user_id: str, period: str = "30d") -> UsageSummary:
        days = PERIOD_DAYS.get(period, 30)
        since = (datetime.now(UTC) - timedelta(days=days)).isoformat() if period != "all" else None

        # ── Session IDs for this user ─────────────────────────────────────
        sess_q = self._db.table("agent_sessions").select("id").eq("user_id", user_id)
        if since:
            sess_q = sess_q.gte("created_at", since)
        sess_result = await sess_q.execute()
        session_ids = [r["id"] for r in (sess_result.data or [])]

        if not session_ids:
            return UsageSummary(
                user_id=user_id, period=period,
                total_messages=0, total_agent_turns=0,
                total_input_tokens=0, total_output_tokens=0,
                estimated_cost_usd=0, tool_call_count=0,
                most_used_tools=[], ai_provider_breakdown={},
            )

        # ── Messages ──────────────────────────────────────────────────────
        msgs_result = await (
            self._db.table("agent_messages")
            .select("role, tokens")
            .in_("session_id", session_ids)
            .execute()
        )
        messages = msgs_result.data or []
        total_messages = len(messages)
        user_messages = sum(1 for m in messages if m["role"] == "user")
        total_tokens = sum(m.get("tokens", 0) for m in messages)

        # ── Tool call logs ─────────────────────────────────────────────────
        tool_result = await (
            self._db.table("agent_tool_logs")
            .select("tool_name, success, provider")
            .in_("session_id", session_ids)
            .execute()
        )
        tool_logs = tool_result.data or []
        tool_call_count = len(tool_logs)

        # Most used tools
        tool_counts: dict[str, int] = {}
        for log in tool_logs:
            tool_counts[log["tool_name"]] = tool_counts.get(log["tool_name"], 0) + 1
        most_used = sorted(
            [{"name": k, "count": v} for k, v in tool_counts.items()],
            key=lambda x: x["count"], reverse=True,
        )[:5]

        # Provider breakdown
        provider_counts: dict[str, int] = {}
        for log in tool_logs:
            p = log.get("provider", "gemini")
            provider_counts[p] = provider_counts.get(p, 0) + 1

        # Rough token split (50/50 heuristic without per-message tracking)
        input_tokens = total_tokens // 2
        output_tokens = total_tokens - input_tokens

        return UsageSummary(
            user_id=user_id,
            period=period,
            total_messages=total_messages,
            total_agent_turns=user_messages,
            total_input_tokens=input_tokens,
            total_output_tokens=output_tokens,
            estimated_cost_usd=_cost(input_tokens, output_tokens),
            tool_call_count=tool_call_count,
            most_used_tools=most_used,
            ai_provider_breakdown=provider_counts,
        )

    async def get_tool_logs(
        self, *, user_id: str, limit: int = 50, session_id: str | None = None
    ) -> ToolCallLogsResponse:
        # Get user sessions
        sess_result = await (
            self._db.table("agent_sessions")
            .select("id").eq("user_id", user_id).execute()
        )
        session_ids = [r["id"] for r in (sess_result.data or [])]
        if not session_ids:
            return ToolCallLogsResponse(logs=[], total=0)

        q = (
            self._db.table("agent_tool_logs")
            .select("*")
            .in_("session_id", session_ids)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if session_id:
            q = q.eq("session_id", session_id)

        result = await q.execute()
        logs = [ToolCallLog(**r) for r in (result.data or [])]
        return ToolCallLogsResponse(logs=logs, total=len(logs))

    async def get_usage_timeline(self, *, user_id: str, days: int = 30) -> UsageTimelineResponse:
        since = (datetime.now(UTC) - timedelta(days=days)).isoformat()

        sess_result = await (
            self._db.table("agent_sessions")
            .select("id").eq("user_id", user_id).execute()
        )
        session_ids = [r["id"] for r in (sess_result.data or [])]

        daily: dict[str, DailyUsage] = {}
        for i in range(days):
            d = (datetime.now(UTC) - timedelta(days=i)).strftime("%Y-%m-%d")
            daily[d] = DailyUsage(date=d, messages=0, tokens=0, tool_calls=0, cost_usd=0)

        if session_ids:
            msgs_result = await (
                self._db.table("agent_messages")
                .select("created_at, tokens")
                .in_("session_id", session_ids)
                .gte("created_at", since)
                .execute()
            )
            for m in (msgs_result.data or []):
                d = m["created_at"][:10]
                if d in daily:
                    daily[d].messages += 1
                    t = m.get("tokens", 0)
                    daily[d].tokens += t
                    daily[d].cost_usd = round(daily[d].cost_usd + _cost(t // 2, t - t // 2), 6)

            tool_result = await (
                self._db.table("agent_tool_logs")
                .select("created_at")
                .in_("session_id", session_ids)
                .gte("created_at", since)
                .execute()
            )
            for t in (tool_result.data or []):
                d = t["created_at"][:10]
                if d in daily:
                    daily[d].tool_calls += 1

        return UsageTimelineResponse(
            user_id=user_id,
            days=sorted(daily.values(), key=lambda x: x.date),
        )

    async def record_tool_call(
        self,
        *,
        session_id: str,
        tool_name: str,
        success: bool,
        duration_ms: int = 0,
        error: str | None = None,
        provider: str = "gemini",
    ) -> None:
        """Called by the agent after every tool execution."""
        await self._db.table("agent_tool_logs").insert({
            "session_id": session_id,
            "tool_name": tool_name,
            "success": success,
            "duration_ms": duration_ms,
            "error": error,
            "provider": provider,
        }).execute()
