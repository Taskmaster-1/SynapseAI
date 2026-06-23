import redis.asyncio as aioredis

from app.core.config import settings
from app.utils.logger import logger

_redis: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis | None:
    """
    Returns a shared async Redis client.
    Returns None if Redis is not configured — callers must handle the None case
    gracefully so the app works without Redis in local dev.
    """
    global _redis
    if not settings.REDIS_URL:
        return None
    if _redis is None:
        try:
            _redis = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            await _redis.ping()
            logger.info("Redis connected", url=settings.REDIS_URL.split("@")[-1])
        except Exception as exc:
            logger.warning("Redis unavailable — running without cache", error=str(exc))
            _redis = None
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None
