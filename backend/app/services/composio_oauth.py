"""
Composio OAuth wiring.

Flow:
  1. Frontend calls POST /agent/tools/connect  { "app": "gmail" }
  2. Backend calls Composio to get an auth URL  → returns { auth_url }
  3. Frontend redirects the user to auth_url
  4. User grants access on the provider's page
  5. Composio redirects to GET /agent/tools/callback?state=...&code=...
  6. Backend completes the connection, saves status to Supabase, notifies frontend

Composio handles the OAuth token storage — we only store metadata (which apps
are connected, when) in our own DB so we can show the user their connection status
without hitting Composio on every request.
"""

from datetime import UTC, datetime

from composio.client.enums import App
from composio import ComposioToolSet

from app.core.config import settings
from app.core.exceptions import AppException, ValidationException
from app.utils.logger import logger
from supabase import AsyncClient

# ── App name → Composio App enum ─────────────────────────────────────────────

APP_NAME_MAP: dict[str, App] = {
    "gmail":           App.GMAIL,
    "googlecalendar":  App.GOOGLECALENDAR,
    "slack":           App.SLACK,
    "notion":          App.NOTION,
    "github":          App.GITHUB,
    "googlesheets":    App.GOOGLESHEETS,
    "linear":          App.LINEAR,
    "linkedin":        App.LINKEDIN,
    "browserbase":     App.BROWSERBASE,
}


class ComposioOAuthService:
    def __init__(self, db: AsyncClient) -> None:
        self._db = db

    def _toolset(self, user_id: str) -> ComposioToolSet:
        return ComposioToolSet(
            api_key=settings.COMPOSIO_API_KEY,
            entity_id=user_id,
        )

    # ── Initiate OAuth ────────────────────────────────────────────────────

    async def initiate_connection(
        self,
        *,
        user_id: str,
        app_name: str,
        redirect_url: str | None = None,
    ) -> dict:
        """
        Starts the OAuth flow for an app.
        Returns { app, auth_url, connection_id }.
        """
        normalized = app_name.lower().strip()
        app = APP_NAME_MAP.get(normalized)
        if not app:
            raise ValidationException(
                f"Unknown app '{app_name}'. Available: {', '.join(APP_NAME_MAP)}"
            )

        try:
            toolset = self._toolset(user_id)
            entity = toolset.get_entity(user_id)
            request = entity.initiate_connection(
                app_name=app,
                redirect_url=redirect_url or f"{settings.APP_BASE_URL}/api/v1/agent/tools/callback",
            )

            logger.info(
                "Composio OAuth initiated",
                user_id=user_id,
                app=normalized,
            )
            return {
                "app": normalized,
                "auth_url": request.redirectUrl,
                "connection_id": getattr(request, "connectedAccountId", None),
            }
        except Exception as exc:
            logger.error("Composio OAuth initiation failed", error=str(exc))
            raise AppException(f"Could not initiate {app_name} connection: {exc}")

    # ── Complete OAuth (callback) ─────────────────────────────────────────

    async def complete_connection(
        self,
        *,
        user_id: str,
        connected_account_id: str,
        app_name: str | None = None,
    ) -> dict:
        """
        Called after Composio redirects back. Persists the connected app
        metadata to our DB so we can show status without pinging Composio.
        """
        try:
            toolset = self._toolset(user_id)
            account = toolset.get_connected_account(connected_account_id)
            resolved_app = app_name or getattr(account, "appName", "unknown").lower()

            await self._save_connection(
                user_id=user_id,
                app_name=resolved_app,
                connected_account_id=connected_account_id,
            )

            logger.info("App connected", user_id=user_id, app=resolved_app)
            return {"status": "connected", "app": resolved_app}
        except Exception as exc:
            logger.error("Composio callback handling failed", error=str(exc))
            raise AppException(f"Could not complete connection: {exc}")

    # ── List connections ──────────────────────────────────────────────────

    async def get_user_connections(self, *, user_id: str) -> list[dict]:
        """
        Returns connected apps from our DB (fast, no external call).
        Falls back to querying Composio if our DB has nothing.
        """
        result = await self._db.table("user_tool_connections") \
            .select("*") \
            .eq("user_id", user_id) \
            .eq("status", "active") \
            .execute()

        if result.data:
            return result.data

        # Fallback: ask Composio directly and sync to DB
        return await self._sync_from_composio(user_id)

    async def disconnect_app(self, *, user_id: str, app_name: str) -> bool:
        """Marks an app as disconnected in our DB."""
        await self._db.table("user_tool_connections") \
            .update({"status": "disconnected", "disconnected_at": datetime.now(UTC).isoformat()}) \
            .eq("user_id", user_id) \
            .eq("app_name", app_name.lower()) \
            .execute()

        logger.info("App disconnected", user_id=user_id, app=app_name)
        return True

    # ── Internal helpers ──────────────────────────────────────────────────

    async def _save_connection(
        self,
        *,
        user_id: str,
        app_name: str,
        connected_account_id: str,
    ) -> None:
        """Upsert a connection record in our DB."""
        await self._db.table("user_tool_connections").upsert({
            "user_id": user_id,
            "app_name": app_name,
            "connected_account_id": connected_account_id,
            "status": "active",
            "connected_at": datetime.now(UTC).isoformat(),
        }, on_conflict="user_id,app_name").execute()

    async def _sync_from_composio(self, user_id: str) -> list[dict]:
        """Query Composio and write results to our DB."""
        try:
            toolset = self._toolset(user_id)
            entity = toolset.get_entity(user_id)
            connections = entity.get_connections()

            result = []
            for conn in connections:
                app_name = getattr(conn, "appName", "").lower()
                account_id = getattr(conn, "id", "")
                if app_name:
                    await self._save_connection(
                        user_id=user_id,
                        app_name=app_name,
                        connected_account_id=account_id,
                    )
                    result.append({"app_name": app_name, "status": "active"})
            return result
        except Exception as exc:
            logger.warning("Could not sync from Composio", error=str(exc))
            return []
