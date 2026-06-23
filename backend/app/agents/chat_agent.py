"""
Groq-powered chat agent with Tavily web search tool support.

The agent runs a tool-loop: if Groq returns a tool_call for `tavily_search`,
it executes the search, appends the result, and re-queries Groq — up to
MAX_TOOL_ITERATIONS times. Falls back to plain Q&A if Tavily is unconfigured.
"""
import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from groq import Groq, AsyncGroq
from openai import OpenAI, APIStatusError
from json_repair import repair_json

from app.agents.memory.manager import MemoryManager
from app.agents.memory.schemas import ChatMessage, MemoryContext
from app.agents.tools.tavily_search import (
    TAVILY_TOOL_DEFINITION,
    format_results_for_llm,
    tavily_search,
)
from app.agents.tools.knowledge_base import (
    KNOWLEDGE_TOOL_DEFINITION,
    search_knowledge_base,
)
from app.agents.tools.confirmation import (
    confirmation_store,
    needs_confirmation,
    build_human_summary,
)
from app.agents.tools.router import ToolRouter
from app.agents.tools.composio_toolkit import ComposioToolkit
from app.services.composio_oauth import ComposioOAuthService, APP_NAME_MAP
from app.services.ai.router import ai_router
from app.core.config import settings
from app.core.exceptions import AIRateLimitException
from app.utils.logger import logger

MAX_TOOL_ITERATIONS = 5


@dataclass
class AgentTurn:
    session_id: str
    user_message: str
    assistant_response: str
    tool_calls: list[dict] = field(default_factory=list)
    pending_confirmations: list[dict] = field(default_factory=list)
    iterations: int = 0
    error: str | None = None
    resumable: bool = False  # True if the agent is waiting for confirmation


SYSTEM_PROMPT = """You are SynapseAI, a helpful and intelligent AI assistant.
You help users with questions, analysis, writing, coding, and general tasks.
Be concise, clear, and helpful. If you don't know something, say so honestly.

You have access to a web search tool (tavily_search). Use it when:
- The user asks about current events, recent news, or live data
- You are uncertain about facts that may have changed after your training cutoff
- The user explicitly asks you to search or look something up

Do NOT use the search tool for general knowledge, creative tasks, coding help,
or anything you can confidently answer from your training data."""


# ── Agent ─────────────────────────────────────────────────────────────────────

class ChatAgent:
    def __init__(self, *, user_id: str, db) -> None:
        self._user_id = user_id
        self._db = db
        self._memory = MemoryManager(db)
        
        # Use OpenAI client pointed to Gemini's endpoint
        self._client = OpenAI(
            api_key=settings.GEMINI_API_KEY,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
        )

        self._tavily_tool: list[dict] | None = (
            [TAVILY_TOOL_DEFINITION]
            if (settings.TAVILY_API_KEY and not settings.TAVILY_API_KEY.startswith("tvly-your"))
            else None
        )

    async def _dispatch_tool(self, name: str, arguments: dict) -> str:
        """Execute a tool by name and return its output as a string."""
        if name == "tavily_search":
            query = arguments.get("query", "")
            max_results = arguments.get("max_results", settings.TAVILY_MAX_RESULTS)
            results = await tavily_search(query=query, max_results=max_results)
            return format_results_for_llm(results)
        
        if name == "search_my_knowledge_base":
            query = arguments.get("query", "")
            limit = arguments.get("limit", 5)
            return await search_knowledge_base(user_id=self._user_id, query=query, limit=limit)
        
        # Dispatch to Composio if not Tavily or Knowledge Base
        toolkit = ComposioToolkit(self._user_id)
        result = await toolkit.execute(action_name=name, params=arguments)
        if result.success:
            return json.dumps(result.data)
        return f"Error executing tool {name}: {result.error}"

    async def chat(self, *, session_id: str, user_message: str) -> AgentTurn:
        chunks: list[str] = []
        turn: AgentTurn | None = None
        async for chunk in self.stream(session_id=session_id, user_message=user_message):
            if isinstance(chunk, str):
                chunks.append(chunk)
            elif isinstance(chunk, AgentTurn):
                turn = chunk
        response_text = "".join(chunks)
        if turn:
            turn.assistant_response = response_text
        return turn or AgentTurn(
            session_id=session_id,
            user_message=user_message,
            assistant_response=response_text,
        )

    async def resume_with_confirmation(
        self,
        *,
        session_id: str,
        confirmation_id: str,
        approved: bool,
    ) -> AsyncIterator[str | AgentTurn]:
        """Continue a turn after the user has approved/rejected an action."""
        conf = confirmation_store.get(confirmation_id)
        if not conf:
            yield "Sorry, this confirmation has expired or is invalid."
            return

        if not approved:
            confirmation_store.reject(confirmation_id)
            # Inject rejection into conversation
            tool_output = f"Action '{conf.action_name}' was REJECTED by the user."
        else:
            confirmation_store.approve(confirmation_id)
            yield f"\n> Executing **{conf.action_name}**..."
            tool_output = await self._dispatch_tool(conf.action_name, conf.params)

        # Load context
        context = await self._memory.load_context(session_id=session_id)
        messages = self._build_messages(context, "") # Empty user message since we're resuming
        
        # Remove the last user message we added in _build_messages if we're resuming from tool output
        if messages and messages[-1]["role"] == "user" and not messages[-1]["content"]:
            messages.pop()

        # We need the assistant's previous tool_call message
        # In a real system, we'd persist the full message list. 
        # For now, we'll append a synthetic assistant message with the tool call
        # but wait — the memory manager only saves 'user' and 'assistant' text content.
        # This is a limitation of the current simple memory.
        
        # FIX: Append the tool result to the conversation history as a system message
        # so the agent knows what happened.
        await self._memory.save_message(ChatMessage(
            session_id=session_id, 
            role="assistant", 
            content=f"[System: Action '{conf.action_name}' result: {tool_output}]"
        ))
        
        # Now just trigger a normal chat follow-up
        async for chunk in self.stream(session_id=session_id, user_message="Continue"):
            yield chunk

    async def stream(
        self,
        *,
        session_id: str,
        user_message: str,
    ) -> AsyncIterator[str | AgentTurn]:
        # Load conversation history
        context = await self._memory.load_context(session_id=session_id)

        # Build the initial messages list
        messages = self._build_messages(context, user_message)

        # Save user message
        if user_message:
            await self._memory.save_message(ChatMessage(
                session_id=session_id, role="user", content=user_message,
            ))

        # Load user's connected Composio apps
        oauth_svc = ComposioOAuthService(self._db)
        connections = await oauth_svc.get_user_connections(user_id=self._user_id)
        active_apps = [c["app_name"] for c in connections if c.get("status") == "active"]

        connected_enums = []
        for app in active_apps:
            if app in APP_NAME_MAP:
                connected_enums.append(APP_NAME_MAP[app])

        # 🧠 SEMANTIC ROUTING: Select only relevant apps to save tokens/latency
        apps_to_load = ToolRouter.route(user_message, connected_enums)

        # Load tools
        toolkit = ComposioToolkit(self._user_id)
        try:
            if apps_to_load:
                composio_tools = await asyncio.to_thread(toolkit.get_groq_tools, apps_to_load)
            else:
                composio_tools = []
        except Exception as exc:
            logger.error("Critical error during tool discovery", error=str(exc))
            composio_tools = [] # Fallback to no tools rather than crashing

        # Combine Tavily, Knowledge Base, and Composio tools
        agent_tools = [KNOWLEDGE_TOOL_DEFINITION] + (self._tavily_tool or []) + composio_tools

        logger.info(
            "Calling AI",
            session_id=session_id,
            model=settings.GEMINI_MODEL,
            tools_enabled=bool(agent_tools),
            composio_apps=active_apps,
        )

        iteration = 0
        executed_tool_calls: list[dict] = []
        pending_confirmations: list[dict] = []
        reply = ""

        # ── Agentic tool-loop ─────────────────────────────────────────────────
        while iteration < MAX_TOOL_ITERATIONS:
            iteration += 1

            try:
                # ── Primary: Gemini with tools ───────────────────────────────────
                primary_error: Exception | None = None
                response = None

                try:
                    response = await asyncio.wait_for(
                        asyncio.to_thread(
                            self._client.chat.completions.create,
                            model=settings.GEMINI_MODEL,
                            messages=messages,
                            tools=agent_tools if agent_tools else None,
                            tool_choice="auto" if agent_tools else None,
                            temperature=0.7,
                            max_tokens=2048,
                        ),
                        timeout=settings.AI_TIMEOUT_SECONDS,
                    )
                except APIStatusError as exc:
                    primary_error = exc
                    # tool_use_failed: Model couldn't parse its own tool call.
                    # Retry without tools so simple messages still get a reply.
                    if "tool_use_failed" in str(exc):
                        logger.warning("Primary tool_use_failed — retrying without tools")
                        try:
                            response = await asyncio.wait_for(
                                asyncio.to_thread(
                                    self._client.chat.completions.create,
                                    model=settings.GEMINI_MODEL,
                                    messages=messages,
                                    temperature=0.7,
                                    max_tokens=2048,
                                ),
                                timeout=settings.AI_TIMEOUT_SECONDS,
                            )
                            primary_error = None  # retry succeeded
                        except Exception as retry_exc:
                            primary_error = retry_exc
                except (asyncio.TimeoutError, Exception) as exc:
                    primary_error = exc

                # ── Fallback: Groq (no tool-calling) ────────────────────────
                if primary_error is not None:
                    err_str = str(primary_error)
                    is_rate_limit = "rate_limit_exceeded" in err_str or "429" in err_str or "quota" in err_str.lower()
                    if is_rate_limit:
                        logger.warning("Primary rate limit hit, falling back to Groq")
                    else:
                        logger.warning("Primary failed, falling back to Groq", error=err_str)

                    try:
                        from app.services.ai.base import AIMessage as AIMsg
                        gemini_msgs = [
                            AIMsg(role=m["role"], content=m.get("content") or "[Thinking...]")
                            for m in messages
                            if m.get("role") in ("user", "assistant")
                        ]
                        fallback_resp = await ai_router.chat(
                            gemini_msgs,
                            system_prompt=SYSTEM_PROMPT,
                            force_provider="groq",
                        )
                        yield fallback_resp.content
                        reply = fallback_resp.content
                        break
                    except AIRateLimitException:
                        # Both Groq and Gemini are rate-limited
                        logger.warning("All AI providers rate-limited")
                        rate_msg = (
                            "⚠️ I'm currently unavailable due to API rate limits on all providers. "
                            "Groq's daily token limit has been reached and Gemini is also throttled. "
                            "Please try again in a few minutes."
                        )
                        yield rate_msg
                        reply = rate_msg
                        break
                    except Exception as fallback_exc:
                        logger.error("Gemini fallback failed", error=str(fallback_exc))
                        raise  # let outer handler deal with non-rate-limit Gemini errors

                choice = response.choices[0]
                finish_reason = choice.finish_reason

                # ── Tool call branch ──────────────────────────────────────────────
                if finish_reason == "tool_calls" and choice.message.tool_calls:
                    # Append the assistant's tool-call message to the conversation
                    messages.append(choice.message.model_dump(exclude_unset=True))

                    should_pause = False
                    for tc in choice.message.tool_calls:
                        tool_name = tc.function.name
                        
                        # 🛠️ Robust JSON Repair for arguments
                        try:
                            raw_args = tc.function.arguments or "{}"
                            repaired = repair_json(raw_args)
                            tool_args = json.loads(repaired)
                        except Exception:
                            tool_args = {}

                        # 🛡️ CHECK: Does this action require human confirmation?
                        if needs_confirmation(tool_name):
                            summary = build_human_summary(tool_name, tool_args)
                            conf = confirmation_store.create(
                                session_id=session_id,
                                action_name=tool_name,
                                params=tool_args,
                                human_summary=summary,
                            )
                            pending_confirmations.append({
                                "id": conf.id,
                                "action": tool_name,
                                "summary": summary,
                            })
                            should_pause = True
                            continue

                        logger.info("Agent calling tool", tool=tool_name, args=tool_args, iteration=iteration)
                        yield f"\n> Calling **{tool_name}**…"

                        tool_output = await self._dispatch_tool(tool_name, tool_args)

                        executed_tool_calls.append({
                            "name": tool_name,
                            "args": tool_args,
                            "result_length": len(tool_output),
                        })

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": tool_output,
                        })

                    if should_pause:
                        yield AgentTurn(
                            session_id=session_id,
                            user_message=user_message,
                            assistant_response="I need your approval to continue.",
                            pending_confirmations=pending_confirmations,
                            iterations=iteration,
                            resumable=True,
                        )
                        return

                    continue

                # ── Text reply branch ─────────────────────────────────────────────
                reply = choice.message.content or ""
                yield reply
                break

            except Exception as exc:
                logger.error("Unexpected agent error", error=str(exc))
                err = f"I'm sorry, I encountered an unexpected error: {exc}"
                yield err
                yield AgentTurn(
                    session_id=session_id,
                    user_message=user_message,
                    assistant_response=err,
                    error=str(exc),
                )
                return

        # ── Persist & finalise ────────────────────────────────────────────────
        await self._memory.save_message(ChatMessage(
            session_id=session_id, role="assistant", content=reply,
        ))

        await self._memory.maybe_summarize(session_id=session_id)

        yield AgentTurn(
            session_id=session_id,
            user_message=user_message,
            assistant_response=reply,
            tool_calls=executed_tool_calls,
            iterations=iteration,
        )

    def _build_messages(self, context: MemoryContext, user_message: str) -> list[dict]:
        """Build OpenAI-format messages from memory context."""
        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

        if context.summary:
            messages.append({
                "role": "user",
                "content": f"[Previous conversation summary]\n{context.summary}",
            })
            messages.append({
                "role": "assistant",
                "content": "Got it, I have the conversation context.",
            })

        for msg in context.recent_messages:
            if msg.role in ("user", "assistant"):
                messages.append({"role": msg.role, "content": msg.content})

        messages.append({"role": "user", "content": user_message})
        return messages
