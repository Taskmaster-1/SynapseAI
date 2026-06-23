from collections.abc import AsyncIterator

from app.agents.chat_agent import ChatAgent
from app.agents.memory.manager import MemoryManager
from app.agents.tools.composio_toolkit import ENABLED_APPS, ComposioToolkit
from app.api.v1.agent.schemas import (
    ChatResponse,
    ConnectedAppsResponse,
    ConnectAppResponse,
    HistoryResponse,
    MessageResponse,
    SessionListResponse,
    SessionResponse,
)
from app.core.exceptions import ForbiddenException, NotFoundException
from supabase import AsyncClient


class AgentService:
    def __init__(self, db: AsyncClient) -> None:
        self._db = db

    # ── Sessions ──────────────────────────────────────────────────────────

    async def list_sessions(self, *, user_id: str) -> SessionListResponse:
        memory = MemoryManager(self._db)
        sessions = await memory.list_sessions(user_id=user_id)
        return SessionListResponse(sessions=[SessionResponse(**s.model_dump()) for s in sessions])

    async def create_session(self, *, user_id: str, title: str | None = None) -> SessionResponse:
        memory = MemoryManager(self._db)
        session = await memory.create_session(user_id=user_id, title=title)
        return SessionResponse(**session.model_dump())

    async def delete_session(self, *, session_id: str, user_id: str) -> None:
        memory = MemoryManager(self._db)
        session = await memory.get_session(session_id=session_id, user_id=user_id)
        if not session:
            raise NotFoundException("Session")
        await memory.delete_session(session_id=session_id, user_id=user_id)

    # ── Chat ──────────────────────────────────────────────────────────────

    async def chat(
        self,
        *,
        user_id: str,
        session_id: str | None,
        message: str,
    ) -> ChatResponse:
        memory = MemoryManager(self._db)

        # Auto-create session if not provided
        if not session_id:
            session = await memory.create_session(user_id=user_id)
            session_id = session.id
        else:
            session = await memory.get_session(session_id=session_id, user_id=user_id)
            if not session:
                raise ForbiddenException("Session not found or access denied")

        agent = ChatAgent(user_id=user_id, db=self._db)
        turn = await agent.chat(session_id=session_id, user_message=message)

        return ChatResponse(
            session_id=session_id,
            response=turn.assistant_response,
            tool_calls=turn.tool_calls,
            iterations=turn.iterations,
        )

    async def stream_chat(
        self,
        *,
        user_id: str,
        session_id: str | None,
        message: str,
    ) -> AsyncIterator[str]:
        """Yields SSE-formatted chunks for the streaming endpoint."""
        from app.agents.chat_agent import AgentTurn

        memory = MemoryManager(self._db)
        if not session_id:
            session = await memory.create_session(user_id=user_id)
            session_id = session.id
            yield f"data: {{\"session_id\": \"{session_id}\"}}\n\n"
        else:
            session = await memory.get_session(session_id=session_id, user_id=user_id)
            if not session:
                raise ForbiddenException("Session not found or access denied")

        agent = ChatAgent(user_id=user_id, db=self._db)
        async for chunk in agent.stream(session_id=session_id, user_message=message):
            if isinstance(chunk, str):
                safe = chunk.replace("\n", "\\n")
                yield f"data: {safe}\n\n"
            elif isinstance(chunk, AgentTurn):
                yield f"data: [DONE]\n\n"

    # ── History ───────────────────────────────────────────────────────────

    async def get_history(self, *, session_id: str, user_id: str) -> HistoryResponse:
        memory = MemoryManager(self._db)
        session = await memory.get_session(session_id=session_id, user_id=user_id)
        if not session:
            raise NotFoundException("Session")

        messages = await memory.get_messages(session_id=session_id, limit=100)
        summary = await memory.get_latest_summary(session_id=session_id)

        return HistoryResponse(
            session_id=session_id,
            messages=[MessageResponse(**m.model_dump()) for m in messages],
            total=len(messages),
            has_summary=summary is not None,
        )

    # ── Tool connections ──────────────────────────────────────────────────

    async def get_connected_apps(self, *, user_id: str) -> ConnectedAppsResponse:
        toolkit = ComposioToolkit(user_id)
        connected = await toolkit.get_connected_apps()
        available = [app.value for app in ENABLED_APPS]
        return ConnectedAppsResponse(connected=connected, available=available)

    async def connect_app(self, *, user_id: str, app_name: str) -> ConnectAppResponse:
        from composio.client.enums import App
        try:
            app = App(app_name.upper())
        except ValueError:
            raise NotFoundException(f"App '{app_name}' not found")

        toolkit = ComposioToolkit(user_id)
        auth_url = toolkit.get_auth_url(app)
        return ConnectAppResponse(app=app_name, auth_url=auth_url)
