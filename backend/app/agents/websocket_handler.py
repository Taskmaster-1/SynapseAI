import asyncio
import json
import traceback
import uuid
from enum import StrEnum
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from app.agents.chat_agent import AgentTurn, ChatAgent
from app.agents.memory.manager import MemoryManager
from app.core.exceptions import UnauthorizedException
from app.db.supabase import get_supabase_client
from app.utils.logger import logger
from jose import JWTError


class WSEventType(StrEnum):
    # Client → Server
    CHAT          = "chat"
    PING          = "ping"
    SWITCH_SESSION = "switch_session"
    NEW_SESSION   = "new_session"
    CONFIRM_ACTION = "confirm_action"

    # Server → Client
    CHUNK         = "chunk"
    TOOL_CALL     = "tool_call"
    TOOL_RESULT   = "tool_result"
    TURN_DONE     = "turn_done"
    SESSION_READY = "session_ready"
    ERROR         = "error"
    PONG          = "pong"
    REQUIRE_CONFIRMATION = "require_confirmation"


def make_event(type: WSEventType, **payload) -> str:
    return json.dumps({"type": type, **payload})


class AgentWebSocketHandler:
    """
    Handles a single user's WebSocket connection.

    Protocol:
      Client sends: {"type": "chat", "message": "...", "session_id": "..."}
      Server sends:
        {"type": "chunk",       "text": "..."}          — streamed text
        {"type": "tool_call",   "name": "...", "params": {...}}
        {"type": "tool_result", "name": "...", "success": true/false}
        {"type": "turn_done",   "iterations": N, "session_id": "..."}
        {"type": "error",       "detail": "..."}
    """

    def __init__(self, websocket: WebSocket) -> None:
        self._ws = websocket
        self._user_id: str | None = None
        self._session_id: str | None = None
        self._db = None

    async def run(self) -> None:
        await self._ws.accept()
        try:
            self._db = await get_supabase_client()
            await self._authenticate()
            await self._event_loop()
        except UnauthorizedException as exc:
            logger.warning("WebSocket auth failed", reason=str(exc))
            await self._send_error(str(exc))
            await self._ws.close(code=4001)
        except WebSocketDisconnect:
            logger.info("WebSocket disconnected", user_id=self._user_id)
        except Exception as exc:
            logger.exception("WebSocket error", error=str(exc))
            await self._send_error(f"Internal Server Error: {exc}")
            await self._ws.close(code=1011)

    # ── Auth ──────────────────────────────────────────────────────────────

    async def _authenticate(self) -> None:
        """
        First message must be: {"type": "auth", "token": "<jwt>"}
        Times out after 10 seconds.
        """
        logger.info("WebSocket: Waiting for auth message...")
        try:
            raw = await asyncio.wait_for(self._ws.receive_text(), timeout=10.0)
        except asyncio.TimeoutError:
            logger.error("WebSocket auth timeout")
            raise UnauthorizedException("Auth timeout")

        try:
            data = json.loads(raw)
            logger.info(f"WebSocket: Received message type: {data.get('type')}")
        except json.JSONDecodeError:
            logger.error("WebSocket: Invalid JSON in auth message")
            raise UnauthorizedException("Invalid JSON")

        if data.get("type") != "auth":
            logger.error(f"WebSocket: First message must be auth, got {data.get('type')}")
            raise UnauthorizedException("First message must be type=auth")

        token = data.get("token", "")
        if not token:
            logger.error("WebSocket: No token provided in auth message")
            raise UnauthorizedException("No token provided")

        try:
            logger.info("WebSocket: Verifying Supabase token...")
            from app.db.supabase import get_supabase_client
            admin = await get_supabase_client()
            user_resp = await admin.auth.get_user(token)
            
            if not user_resp or not user_resp.user:
                logger.error("WebSocket: Supabase verification failed - user not found")
                raise UnauthorizedException("Invalid or expired token")
            
            self._user_id = str(user_resp.user.id)
            logger.info(f"WebSocket: Authenticated user {self._user_id}")
        except UnauthorizedException:
            raise
        except Exception as exc:
            logger.error(f"WebSocket: Supabase auth error: {exc}")
            raise UnauthorizedException(f"Auth failed: {exc}")

        await self._ws.send_text(make_event(WSEventType.SESSION_READY, user_id=self._user_id))



    # ── Event loop ────────────────────────────────────────────────────────

    async def _event_loop(self) -> None:
        while True:
            raw = await self._ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await self._send_error("Invalid JSON")
                continue

            event_type = data.get("type")

            if event_type == WSEventType.PING:
                await self._ws.send_text(make_event(WSEventType.PONG))

            elif event_type == WSEventType.NEW_SESSION:
                await self._handle_new_session(data.get("title"))

            elif event_type == WSEventType.SWITCH_SESSION:
                await self._handle_switch_session(data.get("session_id"))

            elif event_type == WSEventType.CHAT:
                await self._handle_chat(
                    message=data.get("message", ""),
                    session_id=data.get("session_id"),
                )

            elif event_type == WSEventType.CONFIRM_ACTION:
                await self._handle_confirm_action(
                    confirmation_id=data.get("confirmation_id"),
                    approved=data.get("approved", False),
                    session_id=data.get("session_id"),
                )
            else:
                await self._send_error(f"Unknown event type: {event_type}")

    # ── Handlers ──────────────────────────────────────────────────────────

    async def _handle_new_session(self, title: str | None = None) -> None:
        memory = MemoryManager(self._db)
        session = await memory.create_session(user_id=self._user_id, title=title)
        self._session_id = session.id
        await self._ws.send_text(make_event(
            WSEventType.SESSION_READY,
            session_id=session.id,
            title=session.title,
        ))

    async def _handle_switch_session(self, session_id: str | None) -> None:
        if not session_id:
            await self._send_error("session_id required")
            return

        memory = MemoryManager(self._db)
        session = await memory.get_session(session_id=session_id, user_id=self._user_id)
        if not session:
            await self._send_error("Session not found")
            return

        self._session_id = session_id
        await self._ws.send_text(make_event(
            WSEventType.SESSION_READY,
            session_id=session_id,
            title=session.title,
        ))

    async def _handle_chat(self, message: str, session_id: str | None = None) -> None:
        if not message.strip():
            await self._send_error("Empty message")
            return

        # Resolve session
        active_session_id = session_id or self._session_id
        if not active_session_id:
            memory = MemoryManager(self._db)
            session = await memory.create_session(user_id=self._user_id)
            active_session_id = session.id
            self._session_id = active_session_id
            await self._ws.send_text(make_event(
                WSEventType.SESSION_READY,
                session_id=active_session_id,
            ))

        agent = ChatAgent(user_id=self._user_id, db=self._db)

        try:
            async for chunk in agent.stream(
                session_id=active_session_id,
                user_message=message,
            ):
                if isinstance(chunk, str):
                    # Detect tool call markers embedded in text
                    if chunk.startswith("\n> Calling **"):
                        tool_name = chunk.strip().removeprefix("> Calling **").rstrip("…").rstrip("*")
                        await self._ws.send_text(make_event(
                            WSEventType.TOOL_CALL,
                            name=tool_name,
                        ))
                    else:
                        await self._ws.send_text(make_event(
                            WSEventType.CHUNK,
                            text=chunk,
                        ))
                elif isinstance(chunk, AgentTurn):
                    # Final metadata event
                    if chunk.pending_confirmations:
                        for conf in chunk.pending_confirmations:
                            await self._ws.send_text(make_event(
                                WSEventType.REQUIRE_CONFIRMATION,
                                id=conf["id"],
                                action=conf["action"],
                                summary=conf["summary"],
                                session_id=active_session_id,
                            ))
                    
                    await self._ws.send_text(make_event(
                        WSEventType.TURN_DONE,
                        session_id=active_session_id,
                        iterations=chunk.iterations,
                        tool_calls=[tc for tc in chunk.tool_calls],
                    ))
        except Exception as exc:
            tb = traceback.format_exc()
            logger.error("Agent stream error", error=str(exc), exc_type=type(exc).__name__, traceback=tb)
            await self._send_error(f"Agent error: {exc or type(exc).__name__}")

    async def _handle_confirm_action(
        self, 
        confirmation_id: str | None, 
        approved: bool, 
        session_id: str | None = None
    ) -> None:
        if not confirmation_id:
            await self._send_error("confirmation_id required")
            return

        active_session_id = session_id or self._session_id
        if not active_session_id:
            await self._send_error("session_id required")
            return

        agent = ChatAgent(user_id=self._user_id, db=self._db)

        try:
            async for chunk in agent.resume_with_confirmation(
                session_id=active_session_id,
                confirmation_id=confirmation_id,
                approved=approved,
            ):
                if isinstance(chunk, str):
                    if chunk.startswith("\n> Executing **"):
                        tool_name = chunk.strip().removeprefix("> Executing **").rstrip("…").rstrip("*")
                        await self._ws.send_text(make_event(
                            WSEventType.TOOL_CALL,
                            name=tool_name,
                        ))
                    else:
                        await self._ws.send_text(make_event(
                            WSEventType.CHUNK,
                            text=chunk,
                        ))
                elif isinstance(chunk, AgentTurn):
                    if chunk.pending_confirmations:
                        for conf in chunk.pending_confirmations:
                            await self._ws.send_text(make_event(
                                WSEventType.REQUIRE_CONFIRMATION,
                                id=conf["id"],
                                action=conf["action"],
                                summary=conf["summary"],
                                session_id=active_session_id,
                            ))

                    await self._ws.send_text(make_event(
                        WSEventType.TURN_DONE,
                        session_id=active_session_id,
                        iterations=chunk.iterations,
                        tool_calls=[tc for tc in chunk.tool_calls],
                    ))
        except Exception as exc:
            logger.error("Agent resume error", error=str(exc))
            await self._send_error(f"Agent resume error: {exc}")

    async def _send_error(self, detail: str) -> None:
        try:
            await self._ws.send_text(make_event(WSEventType.ERROR, detail=detail))
        except Exception:
            pass
