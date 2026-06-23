import json

from app.api.v1.preferences.schemas import UpdatePreferencesRequest, UserPreferences
from app.services.cache.redis_client import get_redis
from app.utils.logger import logger
from supabase import AsyncClient

PREF_CACHE_TTL = 300


def _cache_key(user_id: str) -> str:
    return f"prefs:{user_id}"


class PreferencesService:
    def __init__(self, db: AsyncClient) -> None:
        self._db = db

    async def get(self, *, user_id: str) -> UserPreferences:
        redis = await get_redis()
        if redis:
            try:
                cached = await redis.get(_cache_key(user_id))
                if cached:
                    return UserPreferences(**json.loads(cached))
            except Exception:
                pass

        result = await self._db.table("user_preferences").select("*").eq("user_id", user_id).execute()
        if result.data:
            prefs = UserPreferences(**result.data[0])
        else:
            prefs = UserPreferences(user_id=user_id)
            await self._db.table("user_preferences").insert(prefs.model_dump()).execute()

        await self._write_cache(user_id, prefs)
        return prefs

    async def update(self, *, user_id: str, payload: UpdatePreferencesRequest) -> UserPreferences:
        updates = payload.model_dump(exclude_none=True)
        if not updates:
            return await self.get(user_id=user_id)
        result = await self._db.table("user_preferences") \
            .upsert({"user_id": user_id, **updates}, on_conflict="user_id").execute()
        prefs = UserPreferences(**result.data[0])
        await self._write_cache(user_id, prefs)
        logger.info("Preferences updated", user_id=user_id, fields=list(updates.keys()))
        return prefs

    async def _write_cache(self, user_id: str, prefs: UserPreferences) -> None:
        redis = await get_redis()
        if redis:
            try:
                await redis.setex(_cache_key(user_id), PREF_CACHE_TTL, prefs.model_dump_json())
            except Exception:
                pass
