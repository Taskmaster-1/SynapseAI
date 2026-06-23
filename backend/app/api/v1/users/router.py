from fastapi import APIRouter, status

from app.api.v1.users.schemas import UpdateProfileRequest, UserResponse
from app.api.v1.users.service import UserService
from app.core.dependencies import CurrentUserDep, DBDep

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: CurrentUserDep):
    """Return the authenticated user's profile."""
    return UserResponse(**current_user)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    payload: UpdateProfileRequest,
    current_user: CurrentUserDep,
    db: DBDep,
):
    """Update name or avatar for the current user."""
    return await UserService(db).update_profile(
        user_id=current_user["id"],
        payload=payload,
    )


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(current_user: CurrentUserDep, db: DBDep):
    """Permanently delete the account and all associated data."""
    await UserService(db).delete_account(user_id=current_user["id"])
