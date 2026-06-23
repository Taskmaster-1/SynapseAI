import asyncio
import warnings
from dataclasses import dataclass, field
from typing import Any, Optional

from composio.client.enums import App
from composio import ComposioToolSet

from app.core.config import settings
from app.utils.logger import logger

# ── Composio SDK bug fix ──────────────────────────────────────────────────────
# TriggerPayloadPropertyModel requires `description: str` but Slack (and other
# apps) return payload properties without a description field, causing a Pydantic
# ValidationError ("12 validation errors for TriggerModel").
#
# Root cause: Composio SDK v0.7.x has a strict model that doesn't match its own
# API responses. We patch description to Optional[str] and then rebuild the full
# parent model chain so the compiled JSON schema is updated everywhere.
try:
    import pydantic
    from composio.client.collections import (
        TriggerPayloadPropertyModel,
        TriggerPayloadModel,
        TriggerModel,
    )
    if TriggerPayloadPropertyModel.model_fields["description"].is_required():
        # Step 1: Make description optional in the leaf model
        new_field = pydantic.fields.FieldInfo(annotation=Optional[str], default=None)
        TriggerPayloadPropertyModel.model_fields["description"] = new_field
        TriggerPayloadPropertyModel.__annotations__["description"] = Optional[str]
        TriggerPayloadPropertyModel.model_rebuild(force=True)

        # Step 2: Rebuild parent models so their compiled schemas pick up the change
        # (Pydantic caches compiled validators — rebuild clears and regenerates them)
        TriggerPayloadModel.model_rebuild(force=True)
        TriggerModel.model_rebuild(force=True)

        logger.info(
            "Applied Composio TriggerPayloadPropertyModel patch "
            "(description → optional, parent models rebuilt)"
        )
except Exception as _patch_exc:
    logger.warning("Could not patch TriggerPayloadPropertyModel", error=str(_patch_exc))



# ── App registry — all enabled integrations ───────────────────────────────────

ENABLED_APPS = [
    App.GMAIL,
    App.GOOGLECALENDAR,
    App.SLACK,
    App.NOTION,
    App.GITHUB,
    App.GOOGLESHEETS,
    App.LINEAR,
    App.LINKEDIN,
    App.BROWSERBASE,
]



@dataclass
class ToolResult:
    tool_name: str
    success: bool
    data: Any = None
    error: str | None = None
    metadata: dict = field(default_factory=dict)


class ComposioToolkit:
    def __init__(self, user_id: str) -> None:
        self._user_id = user_id
        self._toolset = ComposioToolSet(
            api_key=settings.COMPOSIO_API_KEY,
            entity_id=user_id,
        )

    @staticmethod
    def _sanitize_schema(schema: dict) -> dict:
        """
        Recursively sanitize a JSON schema to be Gemini-compatible.
        """
        STRIP_KEYS = {"examples", "default", "$schema", "additionalProperties",
                      "$defs", "$ref", "anyOf", "oneOf", "allOf", "format",
                      "exclusiveMinimum", "exclusiveMaximum", "contentEncoding",
                      "contentMediaType"}

        TYPE_MAP = {
            "object": "OBJECT", "string": "STRING", "number": "NUMBER",
            "integer": "INTEGER", "boolean": "BOOLEAN", "array": "ARRAY",
            "null": "STRING",
        }

        if not isinstance(schema, dict):
            return schema

        result: dict = {}
        for k, v in schema.items():
            if k in STRIP_KEYS:
                continue
            if k == "type":
                raw = v if isinstance(v, str) else (v[0] if isinstance(v, list) else "STRING")
                result["type"] = TYPE_MAP.get(raw.lower(), raw.upper())
            elif k == "properties" and isinstance(v, dict):
                result["properties"] = {
                    pk: ComposioToolkit._sanitize_schema(pv) for pk, pv in v.items()
                }
            elif k == "items" and isinstance(v, dict):
                result["items"] = ComposioToolkit._sanitize_schema(v)
            else:
                result[k] = v

        if result.get("properties") and not result.get("type"):
            result["type"] = "OBJECT"

        return result

    def _safe_get_schemas(self, target_apps: list[App]):
        """
        Internal helper to fetch schemas while handling Pydantic validation errors
        that occur within the Composio SDK for certain apps/triggers.
        
        We force one-by-one fetching to ensure one bad app doesn't kill the loop.
        """
        all_schemas = []
        for app in target_apps:
            try:
                # Use a very short timeout and isolate the call
                schemas = self._toolset.get_action_schemas(
                    apps=[app], 
                    check_connected_accounts=False
                )
                if schemas:
                    all_schemas.extend(schemas)
            except Exception as exc:
                # Catching EVERYTHING here (Pydantic errors, SDK errors, etc.)
                logger.error(
                    "Bypassing broken tool schema", 
                    app=str(app), 
                    error_type=type(exc).__name__,
                    error=str(exc)
                )
                continue
        return all_schemas

    def get_gemini_tools(self, apps: list[App] | None = None) -> list:
        target_apps = apps if apps is not None else ENABLED_APPS
        if not target_apps:
            return []

        schemas = self._safe_get_schemas(target_apps)
        genai_tools = []
        for action in schemas:
            try:
                # Safely extract action data
                action_name = getattr(action, "name", "unknown").replace("-", "_")
                action_description = getattr(action, "description", "") or f"Execute {action_name}"

                if hasattr(action.parameters, "model_dump"):
                    raw_params = action.parameters.model_dump(exclude_none=True)
                elif hasattr(action.parameters, "dict"):
                    raw_params = action.parameters.dict(exclude_none=True)
                elif isinstance(action.parameters, dict):
                    raw_params = action.parameters
                else:
                    raw_params = {}

                params_schema = self._sanitize_schema(raw_params)

                if not params_schema.get("type"):
                    params_schema["type"] = "OBJECT" if params_schema.get("properties") else "STRING"

                fn_decl = {
                    "name": action_name,
                    "description": action_description[:1024],
                    "parameters": params_schema,
                }
                genai_tools.append({"function_declarations": [fn_decl]})
            except Exception as exc:
                logger.warning("Skipping malformed tool schema", action=getattr(action, "name", "?"), error=str(exc))
                continue

        return genai_tools

    def get_groq_tools(self, apps: list[App] | None = None) -> list[dict]:
        target_apps = apps if apps is not None else ENABLED_APPS
        if not target_apps:
            return []

        schemas = self._safe_get_schemas(target_apps)
        groq_tools = []
        for action in schemas:
            try:
                action_name = getattr(action, "name", "unknown").replace("-", "_")
                action_description = getattr(action, "description", "") or f"Execute {action_name}"

                if hasattr(action.parameters, "model_dump"):
                    params = action.parameters.model_dump(exclude_none=True)
                elif hasattr(action.parameters, "dict"):
                    params = action.parameters.dict(exclude_none=True)
                elif isinstance(action.parameters, dict):
                    params = action.parameters
                else:
                    params = {"type": "object", "properties": {}}

                if not params.get("type"):
                    params["type"] = "object"

                groq_tools.append({
                    "type": "function",
                    "function": {
                        "name": action_name,
                        "description": action_description[:1024],
                        "parameters": params,
                    },
                })
            except Exception as exc:
                logger.warning("Skipping malformed tool schema", action=getattr(action, "name", "?"), error=str(exc))
                continue

        return groq_tools

    async def execute(self, *, action_name: str, params: dict[str, Any]) -> ToolResult:
        try:
            logger.info("Executing Composio tool", user_id=self._user_id, action=action_name)
            result = await asyncio.to_thread(
                self._toolset.execute_action,
                action=action_name,
                params=params,
                entity_id=self._user_id,
            )
            return ToolResult(tool_name=action_name, success=True, data=result)
        except Exception as exc:
            logger.error("Composio tool execution failed", action=action_name, error=str(exc))
            return ToolResult(tool_name=action_name, success=False, error=str(exc))

    async def get_connected_apps(self) -> list[str]:
        try:
            entity = self._toolset.get_entity(self._user_id)
            connections = entity.get_connections()
            return [c.appName for c in connections]
        except Exception as exc:
            logger.warning("Could not fetch connected apps", error=str(exc))
            return []

    def get_auth_url(self, app: App) -> str:
        entity = self._toolset.get_entity(self._user_id)
        connection_request = entity.initiate_connection(app_name=app)
        return connection_request.redirectUrl
