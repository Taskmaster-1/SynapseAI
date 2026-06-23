from datetime import UTC, datetime
from typing import Literal

APP_DESCRIPTIONS = {
    "GMAIL":          "Gmail — read, draft, send, and reply to emails",
    "GOOGLECALENDAR": "Google Calendar — list, create, update, find free slots",
    "SLACK":          "Slack — send messages, read channels, set reminders",
    "NOTION":         "Notion — create and search pages and database entries",
    "GITHUB":         "GitHub — manage repos, issues, and pull requests",
    "GOOGLESHEETS":   "Google Sheets — read data, update cells, create spreadsheets",
    "LINEAR":         "Linear — create and manage engineering issues",
    "LINKEDIN":       "LinkedIn — create posts and read profile info",
    "BROWSERBASE":    "Browserbase — browse the web, screenshots, fill forms",
}

TONE_INSTRUCTIONS = {
    "professional": "Use a professional, formal tone.",
    "casual":       "Use a friendly, conversational tone.",
    "concise":      "Be extremely concise — short sentences, minimal words.",
    "detailed":     "Be thorough and detailed in all explanations.",
}

BEHAVIOR_RULES = """
## Rules
- Use tools proactively when the request clearly requires external data or action.
- Before sending emails, posting to LinkedIn, or deleting anything — confirm with the user unless explicitly approved in this message.
- After each tool call briefly summarise what happened (1-2 sentences max).
- If a tool fails, explain why and suggest an alternative.
- Never fabricate information — use a tool to look it up or say you don't know.
- Skip preamble. Users are busy.
- When scheduling, check calendar availability before creating an event.
- When drafting emails, show the draft before sending.
"""

MEMORY_INSTRUCTIONS = """
## Memory
A summary of earlier conversation history appears above recent messages.
Treat it as ground truth for everything the user told you previously.
"""


def build_system_prompt(
    *,
    connected_apps: list[str],
    user_name: str | None = None,
    user_timezone: str = "UTC",
    agent_tone: str = "professional",
    extra_instructions: str | None = None,
    work_hours: tuple[int, int] = (9, 18),
    work_days: list[int] | None = None,
) -> str:
    now = datetime.now(UTC)
    now_str = now.strftime("%A, %B %-d %Y at %H:%M UTC")
    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    days_str = ", ".join(day_names[d] for d in (work_days or [0,1,2,3,4]))

    greeting = f"You are assisting **{user_name}**." if user_name else "You are a personal productivity assistant."
    tone = TONE_INSTRUCTIONS.get(agent_tone, TONE_INSTRUCTIONS["professional"])

    connected_upper = {app.upper() for app in connected_apps}
    tool_lines = [
        f"  • {desc}" for app, desc in APP_DESCRIPTIONS.items()
        if app in connected_upper
    ]
    tools_section = "## Connected tools\n" + (
        "\n".join(tool_lines) if tool_lines
        else "  No tools connected yet. Suggest the user connects tools via Settings."
    )

    parts = [
        f"You are a highly capable personal productivity assistant.\n{greeting}",
        f"Current time: {now_str} | Timezone: {user_timezone}",
        f"Work hours: {work_hours[0]}:00–{work_hours[1]}:00 on {days_str}",
        tone,
        f"\n{tools_section}",
        BEHAVIOR_RULES.strip(),
        MEMORY_INSTRUCTIONS.strip(),
    ]

    if extra_instructions:
        parts.append(f"\n## Custom instructions\n{extra_instructions.strip()}")

    return "\n\n".join(parts)
