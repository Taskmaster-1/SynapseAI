"""
Per-user rate limiting using a Redis sliding window counter.

Limits:
  - Agent chat:         20 requests / minute  per user
  - AI completions:     60 requests / minute  per user
  - File uploads:       10 requests / minute  per user
  - Tool connections:    5 requests / minute  per user

Falls back gracefully if Redis is unavailable (no-op — requests pass through).
"""

from enum import StrEnum
from functools import wraps
from typing import Callable

from fastapi import HTTPException, Request, status

from app.services.cache.redis_client import get_redis
from app.utils.logger import logger


class RateLimitTier(StrEnum):
    AGENT_CHAT      = "agent_chat"
    AI_COMPLETION   = "ai_completion"
    FILE_UPLOAD     = "file_upload"
    TOOL_CONNECT    = "tool_connect"
    DEFAULT         = "default"


# requests_per_minute per tier
TIER_LIMITS: dict[RateLimitTier, int] = {
    RateLimitTier.AGENT_CHAT:    20,
    RateLimitTier.AI_COMPLETION: 60,
    RateLimitTier.FILE_UPLOAD:   10,
    RateLimitTier.TOOL_CONNECT:   5,
    RateLimitTier.DEFAULT:       60,
}


def _window_key(user_id: str, tier: RateLimitTier, window: int) -> str:
    """Key scoped to user + tier + current 60-second window."""
    return f"ratelimit:{tier}:{user_id}:{window}"


async def check_rate_limit(user_id: str, tier: RateLimitTier = RateLimitTier.DEFAULT) -> None:
    """
    Raises HTTP 429 if the user exceeds the tier's per-minute limit.
    Uses a fixed 60-second tumbling window in Redis.
    """
    redis = await get_redis()
    if not redis:
        return  # fail open when Redis is unavailable

    limit = TIER_LIMITS.get(tier, TIER_LIMITS[RateLimitTier.DEFAULT])
    import time
    window = int(time.time()) // 60   # current 60-second bucket
    key = _window_key(user_id, tier, window)

    try:
        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, 90)   # keep for 1.5 windows
        results = await pipe.execute()
        count = results[0]

        if count > limit:
            logger.warning("Rate limit exceeded", user_id=user_id, tier=tier, count=count)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "rate_limit_exceeded",
                    "message": f"Too many requests. Limit: {limit}/min for {tier}.",
                    "limit": limit,
                    "tier": tier,
                },
                headers={"Retry-After": "60"},
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Rate limit check failed (Redis error)", error=str(exc))
        # Fail open — don't block the request if Redis errors


async def get_remaining(user_id: str, tier: RateLimitTier = RateLimitTier.DEFAULT) -> dict:
    """Returns current usage and remaining quota for this user/tier."""
    redis = await get_redis()
    limit = TIER_LIMITS.get(tier, TIER_LIMITS[RateLimitTier.DEFAULT])
    if not redis:
        return {"limit": limit, "remaining": limit, "reset_in_seconds": 60}

    import time
    window = int(time.time()) // 60
    key = _window_key(user_id, tier, window)
    try:
        count = int(await redis.get(key) or 0)
        return {
            "limit": limit,
            "used": count,
            "remaining": max(0, limit - count),
            "reset_in_seconds": 60 - (int(time.time()) % 60),
        }
    except Exception:
        return {"limit": limit, "remaining": limit, "reset_in_seconds": 60}


# ── FastAPI dependency factory ────────────────────────────────────────────────

def rate_limit(tier: RateLimitTier):
    """
    Dependency factory. Use as:
        @router.post("/chat")
        async def chat(
            _: Annotated[None, Depends(rate_limit(RateLimitTier.AGENT_CHAT))],
            current_user: CurrentUserDep,
            ...
        )
    """
    from fastapi import Depends
    from typing import Annotated
    from app.core.dependencies import get_current_user_id

    async def _check(user_id: Annotated[str, Depends(get_current_user_id)]) -> None:
        await check_rate_limit(user_id=user_id, tier=tier)

    return Depends(_check)
