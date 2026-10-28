---
name: follow-up-nudges
description: Find emails the user sent that never got an answer and draft short, friendly follow-ups. Use when the user asks who has not replied, what they are waiting on, or to chase people.
license: MIT
---

# Follow-up nudges

## Steps

1. Search the user's sent mail for the window they gave, or the last 14 days by default
   (`gmail_search` with `in:sent newer_than:14d`).
2. For each thread, read it (`gmail_read_thread`) and keep it only if:
   - the user's message is the last one in the thread, and
   - it asked a question or requested something, and
   - it is at least three working days old.
3. List the candidates: recipient, subject, what was asked, days waiting. Ask the user which
   ones to chase, unless they already said "all".
4. For each chosen thread, draft a reply in the same thread (pass `replyToMessageId`). Two or
   three sentences: a reminder of the ask, a concrete next step, and a date if one matters.
   Match the language and tone of the original email.
5. Prefer `gmail_create_draft` so the user can send the nudges themselves. Use `gmail_send`
   only when the user asked you to send, and then propose them together with `propose_plan`.

## Rules

- Only write to people who are already in the thread. Never add new recipients.
- No guilt, no "just checking in", no "as per my last email".
- If someone replied in another thread or by calendar invite, do not nudge them.
