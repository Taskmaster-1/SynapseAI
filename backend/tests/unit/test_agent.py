import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.agents.memory.manager import MemoryManager
from app.agents.memory.schemas import ChatMessage, MemoryContext


@pytest.mark.asyncio
class TestMemoryManager:

    async def test_load_context_empty_session(self, mock_db):
        """Fresh session returns empty context."""
        mock_db.execute = AsyncMock(return_value=MagicMock(data=[], count=0))
        manager = MemoryManager(mock_db)

        with patch.object(manager, "count_messages", return_value=0), \
             patch.object(manager, "get_latest_summary", return_value=None), \
             patch.object(manager, "get_messages", return_value=[]):
            ctx = await manager.load_context(session_id="session-1")

        assert ctx.summary is None
        assert ctx.recent_messages == []
        assert ctx.total_message_count == 0

    async def test_load_context_with_messages(self, mock_db):
        """Returns recent messages and summary when they exist."""
        from app.agents.memory.schemas import ConversationSummary
        from datetime import datetime, UTC

        messages = [
            ChatMessage(session_id="s1", role="user", content="Hello"),
            ChatMessage(session_id="s1", role="assistant", content="Hi there!"),
        ]
        summary = ConversationSummary(
            session_id="s1",
            summary="User greeted assistant.",
            message_count=5,
            up_to_message_id="msg-5",
        )

        manager = MemoryManager(mock_db)
        with patch.object(manager, "count_messages", return_value=7), \
             patch.object(manager, "get_latest_summary", return_value=summary), \
             patch.object(manager, "get_messages", return_value=messages):
            ctx = await manager.load_context(session_id="s1")

        assert ctx.summary == "User greeted assistant."
        assert len(ctx.recent_messages) == 2
        assert ctx.total_message_count == 7

    async def test_maybe_summarize_below_threshold(self, mock_db):
        """Does NOT summarize when message count is below threshold."""
        manager = MemoryManager(mock_db)
        with patch.object(manager, "count_messages", return_value=10):
            result = await manager.maybe_summarize(session_id="s1")
        assert result is False

    async def test_create_session(self, mock_db):
        mock_db.execute = AsyncMock(return_value=MagicMock(data=[{
            "id": "new-session-id",
            "user_id": "user-1",
            "title": "Test session",
            "created_at": None,
            "updated_at": None,
        }]))
        manager = MemoryManager(mock_db)
        session = await manager.create_session(user_id="user-1", title="Test session")
        assert session.id == "new-session-id"
        assert session.user_id == "user-1"


@pytest.mark.asyncio
class TestAgentService:

    async def test_chat_creates_session_when_none(self, mock_db, mock_user):
        """Auto-creates a session when session_id is not provided."""
        from app.api.v1.agent.service import AgentService
        from app.agents.memory.schemas import AgentSession
        from datetime import datetime, UTC

        mock_session = AgentSession(
            id="auto-session",
            user_id=mock_user["id"],
            title="New conversation",
        )

        with patch("app.api.v1.agent.service.MemoryManager") as MockMemory, \
             patch("app.api.v1.agent.service.ChatAgent") as MockAgent:

            mock_memory_instance = AsyncMock()
            mock_memory_instance.create_session = AsyncMock(return_value=mock_session)
            MockMemory.return_value = mock_memory_instance

            mock_agent_instance = AsyncMock()
            mock_agent_instance.chat = AsyncMock(return_value=MagicMock(
                assistant_response="Hello!",
                tool_calls=[],
                iterations=1,
            ))
            MockAgent.return_value = mock_agent_instance

            service = AgentService(mock_db)
            result = await service.chat(
                user_id=mock_user["id"],
                session_id=None,
                message="Hello",
            )

        assert result.session_id == "auto-session"
        assert result.response == "Hello!"
