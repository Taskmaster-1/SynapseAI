from fastapi import APIRouter
from app.api.v1.preferences.schemas import UpdatePreferencesRequest, UserPreferences
from app.api.v1.preferences.service import PreferencesService
from app.core.dependencies import CurrentUserDep, DBDep

router = APIRouter(prefix="/preferences", tags=["Preferences"])

@router.get("/", response_model=UserPreferences)
async def get_preferences(current_user: CurrentUserDep, db: DBDep):
    """Get current user preferences (returns defaults on first call)."""
    return await PreferencesService(db).get(user_id=current_user["id"])

@router.patch("/", response_model=UserPreferences)
async def update_preferences(payload: UpdatePreferencesRequest, current_user: CurrentUserDep, db: DBDep):
    """Update one or more preferences. Unset fields are unchanged."""
    return await PreferencesService(db).update(user_id=current_user["id"], payload=payload)
