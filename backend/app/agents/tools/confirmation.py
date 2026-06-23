"""
Tool confirmation middleware.

Certain actions are "irreversible" — sending emails, posting to LinkedIn, deleting records.
Before executing these, the agent should pause and confirm with the user.

This module provides:
  1. A registry of which actions require confirmation
  2. A ConfirmationRequest schema the agent emits instead of calling the tool
  3. A ConfirmationStore that tracks pending confirmations per session
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from app.utils.logger import logger

# ── Actions that always require explicit confirmation ─────────────────────────

CONFIRMATION_REQUIRED: set[str] = {
    # Gmail
    "GMAIL_SEND_EMAIL",
    "GMAIL_REPLY_TO_EMAIL",
    # Calendar
    "GOOGLECALENDAR_DELETE_EVENT",
    # Slack
    "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
    # LinkedIn
    "LINKEDIN_CREATE_TEXT_POST",
    # GitHub
    "GITHUB_CREATE_A_PULL_REQUEST",
    # Notion
    "NOTION_UPDATE_PAGE",
    # Sheets
    "GOOGLESHEETS_BATCH_UPDATE",
    # Linear
    "LINEAR_UPDATE_ISSUE",
    # Browserbase
    "BROWSERBASE_FILL_INPUT",
    "BROWSERBASE_CLICK_ELEMENT",
}

# ── Safe read-only actions (never need confirmation) ──────────────────────────

READ_ONLY_ACTIONS: set[str] = {
    "GMAIL_FETCH_EMAILS",
    "GMAIL_SEARCH_EMAILS",
    "GMAIL_GET_ATTACHMENT",
    "GOOGLECALENDAR_LIST_EVENTS",
    "GOOGLECALENDAR_FIND_FREE_SLOTS",
    "SLACK_GET_CHANNEL_MESSAGES",
    "SLACK_LIST_CHANNELS",
    "NOTION_SEARCH_PAGES",
    "NOTION_GET_PAGE",
    "GITHUB_LIST_REPOS",
    "GITHUB_GET_ISSUES",
    "GITHUB_LIST_PULL_REQUESTS",
    "GOOGLESHEETS_READ_RANGE",
    "GOOGLESHEETS_GET_SPREADSHEET_INFO",
    "LINEAR_GET_TEAMS",
    "LINEAR_LIST_ISSUES",
    "LINEAR_GET_COMMENTS",
    "LINKEDIN_GET_PROFILE",
    "BROWSERBASE_SCREENSHOT",
    "BROWSERBASE_GET_PAGE_TEXT",
    "BROWSERBASE_NAVIGATE_URL",
}


@dataclass
class PendingConfirmation:
    id: str
    session_id: str
    action_name: str
    params: dict[str, Any]
    human_summary: str        # a plain-English description the UI shows the user
    expires_at: datetime
    approved: bool | None = None   # None = pending, True = approved, False = rejected


@dataclass
class ConfirmationStore:
    """In-memory store for pending confirmations (per process). Fine for single-instance."""
    _store: dict[str, PendingConfirmation] = field(default_factory=dict)
    _ttl_minutes: int = 5

    def create(
        self,
        *,
        session_id: str,
        action_name: str,
        params: dict[str, Any],
        human_summary: str,
    ) -> PendingConfirmation:
        confirmation = PendingConfirmation(
            id=str(uuid.uuid4()),
            session_id=session_id,
            action_name=action_name,
            params=params,
            human_summary=human_summary,
            expires_at=datetime.now(UTC) + timedelta(minutes=self._ttl_minutes),
        )
        self._store[confirmation.id] = confirmation
        logger.info(
            "Confirmation created",
            confirmation_id=confirmation.id,
            action=action_name,
        )
        return confirmation

    def get(self, confirmation_id: str) -> PendingConfirmation | None:
        conf = self._store.get(confirmation_id)
        if conf and datetime.now(UTC) > conf.expires_at:
            del self._store[confirmation_id]
            return None
        return conf

    def approve(self, confirmation_id: str) -> PendingConfirmation | None:
        conf = self.get(confirmation_id)
        if conf:
            conf.approved = True
        return conf

    def reject(self, confirmation_id: str) -> PendingConfirmation | None:
        conf = self.get(confirmation_id)
        if conf:
            conf.approved = False
        return conf

    def purge_expired(self) -> int:
        now = datetime.now(UTC)
        expired = [k for k, v in self._store.items() if now > v.expires_at]
        for k in expired:
            del self._store[k]
        return len(expired)


# Singleton store shared across all agent instances in the process
confirmation_store = ConfirmationStore()


def needs_confirmation(action_name: str) -> bool:
    return action_name.upper() in CONFIRMATION_REQUIRED


def build_human_summary(action_name: str, params: dict[str, Any]) -> str:
    """Generates a readable description of what the agent wants to do."""
    summaries = {
        "GMAIL_SEND_EMAIL": lambda p: (
            f"Send email to **{p.get('to', '?')}** "
            f"with subject: \"{p.get('subject', '(no subject)').strip()}\""
        ),
        "GMAIL_REPLY_TO_EMAIL": lambda p: (
            f"Reply to email thread **{p.get('thread_id', '?')}**"
        ),
        "GOOGLECALENDAR_DELETE_EVENT": lambda p: (
            f"Delete calendar event **{p.get('event_id', '?')}**"
        ),
        "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL": lambda p: (
            f"Post to Slack channel **{p.get('channel', '?')}**: "
            f"\"{str(p.get('message', ''))[:80]}\""
        ),
        "LINKEDIN_CREATE_TEXT_POST": lambda p: (
            f"Publish LinkedIn post: \"{str(p.get('text', ''))[:120]}…\""
        ),
        "GITHUB_CREATE_A_PULL_REQUEST": lambda p: (
            f"Open PR: **{p.get('title', '?')}** "
            f"({p.get('head', '?')} → {p.get('base', '?')})"
        ),
        "GOOGLESHEETS_BATCH_UPDATE": lambda p: (
            f"Write to Google Sheet **{p.get('spreadsheet_id', '?')}** "
            f"at range **{p.get('range', '?')}**"
        ),
        "LINEAR_UPDATE_ISSUE": lambda p: (
            f"Update Linear issue **{p.get('issue_id', '?')}** "
            f"with: {str(p)[:80]}"
        ),
    }
    builder = summaries.get(action_name.upper())
    if builder:
        try:
            return builder(params)
        except Exception:
            pass
    return f"Execute **{action_name}** with params: {str(params)[:120]}"
