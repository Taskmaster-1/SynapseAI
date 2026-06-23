from typing import Annotated

from fastapi import Depends, Header
from jose import JWTError

from app.core.exceptions import UnauthorizedException, SubscriptionRequiredException
from app.db.supabase import get_supabase_client
from supabase import AsyncClient


# ── Database ──────────────────────────────────────────────────────────────────

async def get_db() -> AsyncClient:
    return await get_supabase_client()


DBDep = Annotated[AsyncClient, Depends(get_db)]


# ── Auth ──────────────────────────────────────────────────────────────────────

async def get_current_user_id(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise UnauthorizedException("Missing or invalid Authorization header")

    token = authorization.removeprefix("Bearer ").strip()

    try:
        from app.db.supabase import get_supabase_client
        admin = await get_supabase_client()
        user_resp = await admin.auth.get_user(token)
        if not user_resp or not user_resp.user:
            raise UnauthorizedException("Invalid or expired token")
        return str(user_resp.user.id)
    except Exception as e:
        raise UnauthorizedException(f"Auth failed: {e}")


CurrentUserIdDep = Annotated[str, Depends(get_current_user_id)]


async def get_current_user(
    user_id: CurrentUserIdDep,
    db: DBDep,
) -> dict:
    """Fetch full user record from Supabase."""
    result = await db.table("users").select("*").eq("id", user_id).single().execute()
    if not result.data:
        raise UnauthorizedException("User not found")
    return result.data


CurrentUserDep = Annotated[dict, Depends(get_current_user)]


async def require_active_subscription(current_user: CurrentUserDep) -> dict:
    """Guard — ensures the user has an active subscription."""
    if current_user.get("subscription_status") not in ("active", "trialing"):
        raise SubscriptionRequiredException()
    return current_user


SubscribedUserDep = Annotated[dict, Depends(require_active_subscription)]
