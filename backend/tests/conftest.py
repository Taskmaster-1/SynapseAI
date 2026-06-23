import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, MagicMock

from app.main import app
from app.core.dependencies import get_current_user_id


# ── App client ────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client(user_id: str) -> AsyncClient:
    # Override auth dependency
    app.dependency_overrides[get_current_user_id] = lambda: user_id
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Auth helpers ──────────────────────────────────────────────────────────────

@pytest.fixture
def user_id() -> str:
    return "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def mock_user(user_id: str) -> dict:
    return {
        "id": user_id,
        "email": "test@example.com",
        "full_name": "Test User",
        "subscription_status": "active",
        "subscription_plan": "pro",
    }


# ── Supabase mock ─────────────────────────────────────────────────────────────

@pytest.fixture
def mock_db():
    db = MagicMock()
    db.table = MagicMock(return_value=db)
    db.select = MagicMock(return_value=db)
    db.insert = MagicMock(return_value=db)
    db.update = MagicMock(return_value=db)
    db.delete = MagicMock(return_value=db)
    db.eq = MagicMock(return_value=db)
    db.single = MagicMock(return_value=db)
    db.execute = AsyncMock(return_value=MagicMock(data=[]))
    return db
