"""
Tavily Search tool for the SynapseAI chat agent.

Provides:
  - `tavily_search(query, max_results)` — async web search
  - `TAVILY_TOOL_DEFINITION`            — Groq-compatible function schema
  - `format_results_for_llm(results)`   — compact string for LLM context
"""
from __future__ import annotations

import asyncio
from typing import Any

from app.core.config import settings
from app.utils.logger import logger

# ── Groq Function Schema ──────────────────────────────────────────────────────

TAVILY_TOOL_DEFINITION: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "tavily_search",
        "description": (
            "Search the web for real-time information. "
            "Use this when the user asks about current events, recent news, "
            "live data (prices, weather, scores), or any topic where your "
            "training data may be outdated. Do NOT call this for general "
            "knowledge questions you already know the answer to."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to look up on the web.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Number of results to return (1–10). Defaults to 5.",
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    },
}


# ── Core Search Function ──────────────────────────────────────────────────────

async def tavily_search(
    query: str,
    max_results: int | None = None,
) -> list[dict[str, Any]]:
    """
    Perform a web search using the Tavily API.

    Args:
        query:       The search query string.
        max_results: Number of results (falls back to settings.TAVILY_MAX_RESULTS).

    Returns:
        List of result dicts: [{title, url, content, score}, ...].
        Returns an empty list if the API key is missing or the call fails.
    """
    api_key = settings.TAVILY_API_KEY
    if not api_key or api_key.startswith("tvly-your"):
        logger.warning("Tavily search skipped — TAVILY_API_KEY not configured")
        return []

    results_count = max_results or settings.TAVILY_MAX_RESULTS

    try:
        from tavily import TavilyClient  # type: ignore

        client = TavilyClient(api_key=api_key)

        # Run the synchronous Tavily client in a thread so we don't block the
        # async event loop.
        response = await asyncio.to_thread(
            client.search,
            query=query,
            search_depth="basic",
            max_results=results_count,
            include_answer=False,
        )

        results: list[dict[str, Any]] = []
        for item in response.get("results", []):
            results.append({
                "title":   item.get("title", ""),
                "url":     item.get("url", ""),
                "content": item.get("content", ""),
                "score":   item.get("score", 0.0),
            })

        logger.info(
            "Tavily search completed",
            query=query,
            num_results=len(results),
        )
        return results

    except ImportError:
        logger.error("tavily-python is not installed — run: pip install tavily-python")
        return []
    except Exception as exc:
        logger.error("Tavily search failed", query=query, error=str(exc))
        return []


# ── Formatting Helper ─────────────────────────────────────────────────────────

def format_results_for_llm(results: list[dict[str, Any]]) -> str:
    """
    Convert Tavily results into a compact string to inject into the LLM context.

    Example output:
        [Web Search Results]
        1. OpenAI releases GPT-5 — https://openai.com/blog/...
           OpenAI today announced GPT-5, a new model that...

        2. GPT-5 benchmarks — https://techcrunch.com/...
           According to TechCrunch, GPT-5 scores...
    """
    if not results:
        return "[Web Search Results]\nNo results found."

    lines = ["[Web Search Results]"]
    for i, r in enumerate(results, start=1):
        lines.append(f"{i}. {r['title']} — {r['url']}")
        if r.get("content"):
            # Trim very long snippets to keep context size manageable
            snippet = r["content"][:400].replace("\n", " ").strip()
            if len(r["content"]) > 400:
                snippet += "…"
            lines.append(f"   {snippet}")
        lines.append("")

    return "\n".join(lines).strip()
