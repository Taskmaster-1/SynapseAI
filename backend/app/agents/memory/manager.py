import uuid
from datetime import UTC, datetime

from app.agents.memory.schemas import AgentSession, ChatMessage, ConversationSummary, MemoryContext
from app.core.config import settings
from app.utils.logger import logger
from supabase import AsyncClient

WINDOW_SIZE = 20          # messages kept in live context
SUMMARIZE_THRESHOLD = 40  # summarize when history exceeds this many messages
SUMMARY_MODEL_PROMPT = (
    "You are a memory assistant. Produce a dense, factual summary of this "
    "conversation that preserves every decision, fact, and preference mentioned. "
    "Write in third-person. Be concise but complete. Do not omit any details the "
    "user or assistant mentioned. Output only the summary text."
)


class MemoryManager:
    def __init__(self, db: AsyncClient) -> None:
        self._db = db

    # ── Sessions ──────────────────────────────────────────────────────────

    async def create_session(self, *, user_id: str, title: str | None = None) -> AgentSession:
        session_id = str(uuid.uuid4())
        row = {
            "id": session_id,
            "user_id": user_id,
            "title": title or "New conversation",
        }
        result = await self._db.table("agent_sessions").insert(row).execute()
        logger.info("Session created", session_id=session_id, user_id=user_id)
        return AgentSession(**result.data[0])

    async def get_session(self, *, session_id: str, user_id: str) -> AgentSession | None:
        result = await (
            self._db.table("agent_sessions")
            .select("*")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .execute()
        )
        return AgentSession(**result.data[0]) if result.data else None

    async def list_sessions(self, *, user_id: str) -> list[AgentSession]:
        result = await (
            self._db.table("agent_sessions")
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .limit(50)
            .execute()
        )
        return [AgentSession(**r) for r in (result.data or [])]

    async def delete_session(self, *, session_id: str, user_id: str) -> None:
        await (
            self._db.table("agent_sessions")
            .delete()
            .eq("id", session_id)
            .eq("user_id", user_id)
            .execute()
        )
        logger.info("Session deleted", session_id=session_id)

    # ── Messages ──────────────────────────────────────────────────────────

    async def save_message(self, message: ChatMessage) -> ChatMessage:
        row = message.model_dump(exclude_none=True)
        row.setdefault("id", str(uuid.uuid4()))
        result = await self._db.table("agent_messages").insert(row).execute()

        # Bump session updated_at
        await (
            self._db.table("agent_sessions")
            .update({"updated_at": datetime.now(UTC).isoformat()})
            .eq("id", message.session_id)
            .execute()
        )
        return ChatMessage(**result.data[0])

    async def get_messages(self, *, session_id: str, limit: int = WINDOW_SIZE) -> list[ChatMessage]:
        result = await (
            self._db.table("agent_messages")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        messages = [ChatMessage(**r) for r in (result.data or [])]
        return list(reversed(messages))  # oldest first

    async def count_messages(self, *, session_id: str) -> int:
        result = await (
            self._db.table("agent_messages")
            .select("id", count="exact")
            .eq("session_id", session_id)
            .execute()
        )
        return result.count or 0

    # ── Summaries ─────────────────────────────────────────────────────────

    async def get_latest_summary(self, *, session_id: str) -> ConversationSummary | None:
        result = await (
            self._db.table("agent_summaries")
            .select("*")
            .eq("session_id", session_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return ConversationSummary(**result.data[0]) if result.data else None

    async def save_summary(self, summary: ConversationSummary) -> ConversationSummary:
        row = summary.model_dump(exclude_none=True)
        row.setdefault("id", str(uuid.uuid4()))
        result = await self._db.table("agent_summaries").insert(row).execute()
        return ConversationSummary(**result.data[0])

    # ── Main API: load context for one turn ───────────────────────────────

    async def load_context(self, *, session_id: str) -> MemoryContext:
        """
        Returns:
        - The latest summary (covers all old messages)
        - The most recent WINDOW_SIZE messages
        - Total message count
        """
        total = await self.count_messages(session_id=session_id)
        summary = await self.get_latest_summary(session_id=session_id)
        recent = await self.get_messages(session_id=session_id, limit=WINDOW_SIZE)

        return MemoryContext(
            session_id=session_id,
            summary=summary.summary if summary else None,
            recent_messages=recent,
            total_message_count=total,
        )

    async def maybe_summarize(self, *, session_id: str) -> bool:
        """
        Triggers summarization when message count exceeds threshold.
        Uses the AI router to generate the summary. Returns True if summarized.
        """
        total = await self.count_messages(session_id=session_id)
        if total < SUMMARIZE_THRESHOLD:
            return False

        # Check if already recently summarized
        existing = await self.get_latest_summary(session_id=session_id)
        if existing and existing.message_count >= total - WINDOW_SIZE:
            return False  # summary is still fresh

        # Fetch all messages older than the sliding window
        old_count = total - WINDOW_SIZE
        result = await (
            self._db.table("agent_messages")
            .select("role, content")
            .eq("session_id", session_id)
            .order("created_at", desc=False)
            .limit(old_count)
            .execute()
        )
        old_messages = result.data or []
        if not old_messages:
            return False

        # Build transcript for the summarizer
        transcript = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in old_messages
        )

        # Import here to avoid circular dependency
        from app.services.ai.base import AIMessage
        from app.services.ai.router import ai_router

        response = await ai_router.chat(
            messages=[AIMessage(role="user", content=transcript)],
            system_prompt=SUMMARY_MODEL_PROMPT,
            max_tokens=800,
            temperature=0.3,
        )

        last_msg_id = old_messages[-1].get("id", "")
        await self.save_summary(ConversationSummary(
            session_id=session_id,
            summary=response.content,
            message_count=old_count,
            up_to_message_id=last_msg_id,
        ))

        logger.info(
            "Conversation summarized",
            session_id=session_id,
            messages_summarized=old_count,
        )
        return True
