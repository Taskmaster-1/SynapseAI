from supabase._async.client import AsyncClient, create_client

from app.core.config import settings

_client: AsyncClient | None = None


async def get_supabase_client() -> AsyncClient:
    """Returns a singleton async Supabase client."""
    global _client
    if _client is None:
        _client = await create_client(
            settings.SUPABASE_URL,
            settings.SUPABASE_SERVICE_ROLE_KEY,  # service role for server-side ops
        )
    return _client


async def get_supabase_anon_client() -> AsyncClient:
    """Returns an anon client (respects Row Level Security)."""
    return await create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_ANON_KEY,
    )
