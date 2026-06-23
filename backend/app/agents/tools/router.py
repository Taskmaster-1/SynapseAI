import re
from typing import Any
from composio.client.enums import App
from app.utils.logger import logger

# ── Semantic Mapping ──────────────────────────────────────────────────────────

APP_KEYWORDS = {
    App.GMAIL: ["email", "mail", "gmail", "message", "inbox", "sent", "receive", "attachment"],
    App.GOOGLECALENDAR: ["calendar", "event", "schedule", "meeting", "appointment", "today", "tomorrow", "day", "week", "busy", "free"],
    App.SLACK: ["slack", "channel", "post", "message", "dm", "notify", "ping", "team"],
    App.GITHUB: ["github", "repo", "repository", "issue", "pr", "pull request", "commit", "code", "star"],
    App.NOTION: ["notion", "page", "database", "note", "doc", "wiki", "workspace"],
    App.LINEAR: ["linear", "issue", "ticket", "task", "project", "backlog", "sprint"],
    App.GOOGLESHEETS: ["sheet", "spreadsheet", "excel", "cell", "row", "column", "data", "table"],
}

class ToolRouter:
    """
    Intelligent tool selection to prevent context bloat and improve LLM accuracy.
    """
    
    @staticmethod
    def route(query: str, connected_apps: list[App]) -> list[App]:
        """
        Analyzes the user query and returns a subset of connected apps that are 
        likely relevant to the request.
        """
        if not connected_apps:
            return []

        query_lower = query.lower()
        selected_apps = set()

        # 1. Direct Keyword Matching
        for app, keywords in APP_KEYWORDS.items():
            if app in connected_apps:
                for kw in keywords:
                    if re.search(r'\b' + re.escape(kw) + r'\b', query_lower):
                        selected_apps.add(app)
                        break

        # 2. Heuristics & Broad Context
        # If the query is very short or general, load a core set of tools
        if not selected_apps and len(query_lower.split()) < 10:
             # Default to a "Core" set if ambiguity is high
             core_apps = {App.GMAIL, App.GOOGLECALENDAR, App.SLACK}
             selected_apps.update(core_apps.intersection(connected_apps))

        # 3. Safety Fallback
        # If still nothing, and there are connected apps, load them all (up to a limit)
        if not selected_apps:
            logger.info("Semantic routing found no matches, falling back to all connected apps")
            return connected_apps[:5] # Limit to top 5 to keep context clean

        logger.info(
            "Semantic routing complete",
            query=query[:50] + "...",
            matches=[str(a) for a in selected_apps]
        )
        return list(selected_apps)
