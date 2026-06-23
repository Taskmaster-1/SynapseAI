from app.api.v1.users.schemas import UpdateProfileRequest, UserResponse
from app.core.exceptions import NotFoundException
from app.utils.logger import logger
from supabase import AsyncClient


class UserService:
    def __init__(self, db: AsyncClient) -> None:
        self._db = db

    async def update_profile(self, *, user_id: str, payload: UpdateProfileRequest) -> UserResponse:
        updates = payload.model_dump(exclude_none=True)
        if not updates:
            result = await self._db.table("users").select("*").eq("id", user_id).single().execute()
            return UserResponse(**result.data)

        result = await self._db.table("users").update(updates).eq("id", user_id).execute()
        if not result.data:
            raise NotFoundException("User")

        logger.info("Profile updated", user_id=user_id, fields=list(updates.keys()))
        return UserResponse(**result.data[0])

    async def delete_account(self, *, user_id: str) -> None:
        # Cascade delete via FK constraints on DB side; here we just remove user row
        await self._db.table("users").delete().eq("id", user_id).execute()
        logger.info("Account deleted", user_id=user_id)
