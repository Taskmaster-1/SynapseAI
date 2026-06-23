from fastapi import APIRouter, Query, WebSocket, status
from fastapi.responses import RedirectResponse, StreamingResponse

from app.agents.websocket_handler import AgentWebSocketHandler
from app.api.v1.agent.schemas import (
    ChatRequest,
    ChatResponse,
    ConnectedAppsResponse,
    ConnectAppRequest,
    ConnectAppResponse,
    DisconnectAppRequest,
    HistoryResponse,
    NewSessionRequest,
    SessionListResponse,
    SessionResponse,
)
from app.api.v1.agent.service import AgentService
from app.core.config import settings
from app.core.dependencies import CurrentUserDep, CurrentUserIdDep, DBDep
from app.middleware.per_user_rate_limit import RateLimitTier, rate_limit
from app.services.composio_oauth import ComposioOAuthService

router = APIRouter(prefix="/agent", tags=["Agent"])


# ── WebSocket ─────────────────────────────────────────────────────────────────

@router.websocket("/ws")
async def agent_websocket(websocket: WebSocket):
    """
    Real-time bidirectional agent chat.

    Handshake: → {"type":"auth","token":"<jwt>"}  ← {"type":"session_ready"}
    Chat:      → {"type":"chat","message":"..."}   ← chunks + turn_done
    Manage:    → {"type":"new_session","title":"..."} | {"type":"switch_session","session_id":"..."}
    Heartbeat: → {"type":"ping"}                   ← {"type":"pong"}
    """
    handler = AgentWebSocketHandler(websocket)
    await handler.run()


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(current_user: CurrentUserDep, db: DBDep):
    """List all conversation sessions for the current user."""
    return await AgentService(db).list_sessions(user_id=current_user["id"])


@router.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(payload: NewSessionRequest, current_user: CurrentUserDep, db: DBDep):
    """Create a new conversation session."""
    return await AgentService(db).create_session(
        user_id=current_user["id"], title=payload.title
    )


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(session_id: str, current_user: CurrentUserDep, db: DBDep):
    """Permanently delete a session and all its messages."""
    await AgentService(db).delete_session(session_id=session_id, user_id=current_user["id"])


# ── Chat (HTTP) ───────────────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, current_user: CurrentUserDep, db: DBDep, _rl=rate_limit(RateLimitTier.AGENT_CHAT)):
    """Non-streaming chat — use WebSocket for production."""
    return await AgentService(db).chat(
        user_id=current_user["id"],
        session_id=payload.session_id,
        message=payload.message,
    )


@router.post("/chat/stream")
async def chat_stream(payload: ChatRequest, current_user: CurrentUserDep, db: DBDep, _rl=rate_limit(RateLimitTier.AGENT_CHAT)):
    """SSE streaming fallback for clients that cannot use WebSocket."""
    return StreamingResponse(
        AgentService(db).stream_chat(
            user_id=current_user["id"],
            session_id=payload.session_id,
            message=payload.message,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── History ───────────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/history", response_model=HistoryResponse)
async def get_history(session_id: str, current_user: CurrentUserDep, db: DBDep):
    """Fetch message history for a session."""
    return await AgentService(db).get_history(
        session_id=session_id, user_id=current_user["id"]
    )


# ── Tool connections (Composio OAuth) ────────────────────────────────────────

@router.get("/tools/connected", response_model=ConnectedAppsResponse)
async def get_connected_apps(current_user: CurrentUserDep, db: DBDep):
    """List which apps the user has connected and what's available."""
    service = ComposioOAuthService(db)
    connections = await service.get_user_connections(user_id=current_user["id"])
    connected = [c["app_name"] for c in connections if c.get("status") == "active"]
    available = list(service.__class__.__module__ and __import__(
        "app.services.composio_oauth", fromlist=["APP_NAME_MAP"]
    ).APP_NAME_MAP.keys())
    return ConnectedAppsResponse(connected=connected, available=available)


@router.post("/tools/connect", response_model=ConnectAppResponse)
async def connect_app(
    payload: ConnectAppRequest,
    current_user: CurrentUserDep,
    db: DBDep,
):
    """
    Start the OAuth flow to connect a new app.
    Returns auth_url — redirect the user there to grant access.
    """
    service = ComposioOAuthService(db)
    result = await service.initiate_connection(
        user_id=current_user["id"],
        app_name=payload.app,
        redirect_url=f"{settings.APP_BASE_URL}/api/v1/agent/tools/callback",
    )
    return ConnectAppResponse(
        app=result["app"],
        auth_url=result["auth_url"],
        message="Visit auth_url to connect this app",
    )


@router.delete("/tools/disconnect")
async def disconnect_app(
    payload: DisconnectAppRequest,
    current_user: CurrentUserDep,
    db: DBDep,
):
    """Disconnect a previously connected app."""
    service = ComposioOAuthService(db)
    await service.disconnect_app(user_id=current_user["id"], app_name=payload.app)
    return {"status": "disconnected", "app": payload.app}


@router.get("/tools/callback")
async def composio_oauth_callback(
    db: DBDep,
    user_id: CurrentUserIdDep,
    connected_account_id: str | None = Query(None),
    state: str | None = Query(None),
    code: str | None = Query(None),
    error: str | None = Query(None),
    app: str | None = Query(None),
):
    """
    Composio redirects here after OAuth completes.
    Saves the connection and redirects the user back to the frontend settings page.
    """
    frontend_settings = f"{settings.FRONTEND_URL}/dashboard/integrations"

    if error:
        return RedirectResponse(url=f"{frontend_settings}?error={error}")

    if connected_account_id:
        try:
            service = ComposioOAuthService(db)
            await service.complete_connection(
                user_id=user_id,
                connected_account_id=connected_account_id,
                app_name=app,
            )
            return RedirectResponse(url=f"{frontend_settings}?connected={app or 'app'}")
        except Exception as exc:
            return RedirectResponse(url=f"{frontend_settings}?error={str(exc)[:80]}")

    return RedirectResponse(url=f"{frontend_settings}?status=pending")
