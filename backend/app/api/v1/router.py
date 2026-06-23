from fastapi import APIRouter

from app.api.v1.agent.router import router as agent_router
from app.api.v1.ai.router import router as ai_router
from app.api.v1.analytics.router import router as analytics_router
from app.api.v1.files.router import router as files_router
from app.api.v1.notifications.router import router as notifications_router
from app.api.v1.payments.router import router as payments_router
from app.api.v1.preferences.router import router as preferences_router
from app.api.v1.users.router import router as users_router

# Import confirmations router
from app.api.v1.agent.confirmations import router as confirmations_router

v1_router = APIRouter(prefix="/api/v1")

v1_router.include_router(users_router)
v1_router.include_router(preferences_router)
v1_router.include_router(ai_router)
v1_router.include_router(agent_router)
v1_router.include_router(analytics_router)
v1_router.include_router(files_router)
v1_router.include_router(payments_router)
v1_router.include_router(notifications_router)
v1_router.include_router(confirmations_router)
