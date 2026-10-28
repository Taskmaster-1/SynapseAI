/**
 * Ready-made automations for the gallery on the Automations page. "Use" opens the normal
 * create form prefilled, so every template is just a valid create request plus copy.
 * Prompts lean on the approval flow: they draft and propose, and anything that sends,
 * changes or deletes waits for the user unless they've allowed it.
 */

/** What a template needs connected. MCP ones are matched by connection name or URL. */
export type TemplateRequirement = "google" | "github" | "linear";

export type TemplateCategory = "Inbox" | "Follow-ups" | "Calendar" | "Planning" | "Engineering";

export interface AutomationTemplate {
  id: string;
  name: string;
  /** One line: what you get. */
  outcome: string;
  category: TemplateCategory;
  trigger: { type: "schedule" } | { type: "gmail"; query: string } | { type: "webhook" };
  /** Cron, for schedule triggers. */
  schedule?: string;
  prompt: string;
  requires: TemplateRequirement[];
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  "Inbox",
  "Follow-ups",
  "Calendar",
  "Planning",
  "Engineering",
];

export const TEMPLATES: AutomationTemplate[] = [
  // ── Inbox ────────────────────────────────────────────────────────────────
  {
    id: "morning-brief",
    name: "Morning brief",
    outcome: "A short read of what came in overnight and what's on today, every weekday at 8.",
    category: "Inbox",
    trigger: { type: "schedule" },
    schedule: "0 8 * * 1-5",
    prompt:
      "Give me my morning brief. Look at unread email from the last 24 hours (gmail_search `is:unread newer_than:1d in:inbox`) and today's calendar. Start with anything urgent or that needs a reply from me today, then today's meetings with times, then a one-line mention of the rest. Keep it under 200 words. Don't send, label or archive anything.",
    requires: ["google"],
  },
  {
    id: "inbox-triage",
    name: "Inbox triage with labels",
    outcome: "Every new email gets a label: Needs reply, FYI, Receipts or Newsletters.",
    category: "Inbox",
    trigger: { type: "gmail", query: "in:inbox" },
    prompt:
      'Sort this email with gmail_organize by adding exactly one label: "Needs reply" if someone is waiting on me, "Receipts" for receipts, invoices and order confirmations, "Newsletters" for newsletters and marketing, otherwise "FYI". Use only labels that already exist in my Gmail; if one is missing, don\'t label it and tell me which label to create. Don\'t archive, reply or delete.',
    requires: ["google"],
  },
  {
    id: "draft-replies",
    name: "Draft replies in your voice",
    outcome: "A ready-to-send draft for each email that needs an answer. You review and send.",
    category: "Inbox",
    trigger: { type: "gmail", query: "in:inbox -category:promotions -category:social" },
    prompt:
      "Decide whether this email needs a reply from me. Skip newsletters, notifications, receipts and anything automated. If it does need one, read the whole thread with gmail_read_thread and save a reply with gmail_create_draft (replyToMessageId set, so it stays in the thread), written in my writing style. Don't invent facts, dates or commitments: where you'd need something only I know, leave a clear [placeholder]. Never send it.",
    requires: ["google"],
  },
  {
    id: "receipts",
    name: "File receipts",
    outcome: "Receipts and invoices get the Receipts label and leave your inbox.",
    category: "Inbox",
    trigger: { type: "gmail", query: 'subject:(receipt OR invoice OR "order confirmation")' },
    prompt:
      'If this email is a receipt, invoice or order confirmation, add the "Receipts" label and archive it with gmail_organize. In the task, note the vendor, amount and date. If it isn\'t one, do nothing.',
    requires: ["google"],
  },
  {
    id: "newsletter-cleanup",
    name: "Newsletter cleanup",
    outcome: "Every Saturday, a single plan to archive the week's read newsletters and promos.",
    category: "Inbox",
    trigger: { type: "schedule" },
    schedule: "0 9 * * 6",
    prompt:
      "Find newsletters and promotional email in my inbox older than 3 days (try `in:inbox older_than:3d category:promotions` and `in:inbox older_than:3d unsubscribe`). Leave anything from a person who wrote to me directly. List what you found grouped by sender, then propose archiving them with gmail_organize in one plan. Archive only; never delete.",
    requires: ["google"],
  },
  {
    id: "urgent-flag",
    name: "Flag urgent email",
    outcome: "Important mail that needs you today gets starred, with a one-line why.",
    category: "Inbox",
    trigger: { type: "gmail", query: "is:important" },
    prompt:
      "Decide if this email needs my attention today: a deadline, a customer or teammate blocked on me, or something going wrong. If so, star it with gmail_organize and say in one line why it's urgent. Otherwise do nothing.",
    requires: ["google"],
  },

  // ── Follow-ups ───────────────────────────────────────────────────────────
  {
    id: "follow-up-nudges",
    name: "Follow-up nudges",
    outcome: "Drafted nudges for emails you sent 3+ days ago that never got an answer.",
    category: "Follow-ups",
    trigger: { type: "schedule" },
    schedule: "0 9 * * 1-5",
    prompt:
      "Find emails I sent between 3 and 10 days ago that asked a question or a favour (gmail_search `in:sent older_than:3d newer_than:10d`). Read each thread; skip ones that got a reply or where I was just answering. For each one still waiting, save a short, friendly follow-up with gmail_create_draft in the same thread, written in my writing style. At most 5 drafts. Never send.",
    requires: ["google"],
  },
  {
    id: "waiting-on",
    name: "Waiting-on list",
    outcome: "Monday morning: who owes you a reply, and since when.",
    category: "Follow-ups",
    trigger: { type: "schedule" },
    schedule: "30 8 * * 1",
    prompt:
      "Make a list of conversations where I'm waiting on someone: emails I sent in the last 3 weeks that asked for something and haven't been answered. For each: who, what I asked, and how long it's been. Oldest first. Just the list; don't draft or send anything.",
    requires: ["google"],
  },
  {
    id: "reply-debt",
    name: "Reply debt",
    outcome: "Friday afternoon: the emails you still owe an answer to, before the weekend.",
    category: "Follow-ups",
    trigger: { type: "schedule" },
    schedule: "0 15 * * 5",
    prompt:
      "Find emails from people (not automated mail) from the last 2 weeks that asked me something and that I haven't replied to. List them with sender, subject and what they need, most overdue first. Offer to draft replies, but don't draft or send anything in this run.",
    requires: ["google"],
  },

  // ── Calendar ─────────────────────────────────────────────────────────────
  {
    id: "meeting-prep",
    name: "Meeting prep",
    outcome: "Each weekday at 7: a prep note for every meeting today with other people.",
    category: "Calendar",
    trigger: { type: "schedule" },
    schedule: "0 7 * * 1-5",
    prompt:
      "For each of today's calendar events with other attendees, write a short prep note: who's coming, why we're meeting (from the event and recent email threads with those attendees), open questions or promises from those threads, and one suggested goal for the meeting. Skip focus blocks and events with only me. Don't change any events or send anything.",
    requires: ["google"],
  },
  {
    id: "weekly-calendar-review",
    name: "Weekly calendar review",
    outcome: "Sunday evening: next week at a glance, with clashes and overloaded days flagged.",
    category: "Calendar",
    trigger: { type: "schedule" },
    schedule: "0 18 * * 0",
    prompt:
      "Review my calendar for the coming Monday to Friday. Summarise each day in one line, then flag: overlapping events, days with more than 5 hours of meetings, meetings with no agenda or description, and invitations I haven't answered. Suggest what I could decline or move, but don't change anything.",
    requires: ["google"],
  },
  {
    id: "decline-conflicts",
    name: "Decline conflicting invites",
    outcome:
      "Invitations that clash with what you've accepted get a polite decline, after your OK.",
    category: "Calendar",
    trigger: { type: "schedule" },
    schedule: "0 9,14 * * 1-5",
    prompt:
      "Look at my calendar for the next 14 days. Find invitations I haven't answered that overlap an event I've already accepted. For each, propose declining with calendar_respond and a short, polite note in my writing style offering another time. Put all of them in one plan. Don't touch events I organise.",
    requires: ["google"],
  },
  {
    id: "focus-time",
    name: "Protect focus time",
    outcome: "Monday morning: two-hour focus blocks proposed in this week's open gaps.",
    category: "Calendar",
    trigger: { type: "schedule" },
    schedule: "0 8 * * 1",
    prompt:
      'Find gaps of 2 hours or more between 9:00 and 17:00 in my calendar this week. Propose one "Focus" block per day (at most 4) with calendar_create_event, with no attendees, in one plan. Skip days that already have a focus block.',
    requires: ["google"],
  },

  // ── Planning ─────────────────────────────────────────────────────────────
  {
    id: "end-of-day",
    name: "End-of-day wrap-up",
    outcome: "At 17:30: what got done, what's still open, and how tomorrow starts.",
    category: "Planning",
    trigger: { type: "schedule" },
    schedule: "30 17 * * 1-5",
    prompt:
      "Wrap up my day: emails I sent today (one line each), emails still waiting for my reply, and tomorrow's first three meetings with times. Under 150 words. Don't send anything.",
    requires: ["google"],
  },
  {
    id: "weekly-update",
    name: "Weekly update draft",
    outcome: "Friday at 16: a status update from your week, saved as a draft to yourself.",
    category: "Planning",
    trigger: { type: "schedule" },
    schedule: "0 16 * * 5",
    prompt:
      "Write my weekly update from this week's sent email and calendar: what moved forward, decisions made, what's next, anything blocked. Three short sections, plain bullets, in my writing style. Save it with gmail_create_draft addressed to me (my address is the sender of any email in `in:sent`), subject \"Weekly update\", so I can edit and forward it. Never send it to anyone.",
    requires: ["google"],
  },

  // ── Engineering (MCP connections) ────────────────────────────────────────
  {
    id: "pr-review",
    name: "Review new pull requests",
    outcome: "Each new PR gets a summary and a list of risks; a review comment only with your OK.",
    category: "Engineering",
    trigger: { type: "webhook" },
    prompt:
      "A GitHub webhook arrived. If it's a newly opened or ready-for-review pull request, read the PR and its diff, then summarise the change in 3 bullets and list anything risky: missing tests, migrations, security-sensitive code, breaking API changes. Propose posting that as a review comment. If the event is anything else, do nothing.",
    requires: ["github"],
  },
  {
    id: "pr-triage",
    name: "Morning PR triage",
    outcome: "Weekdays at 9: PRs waiting on your review, oldest first.",
    category: "Engineering",
    trigger: { type: "schedule" },
    schedule: "0 9 * * 1-5",
    prompt:
      "List open pull requests where my review is requested, oldest first, with author, age, size and a one-line summary. Then list my own open PRs that have new comments or failing checks. Don't comment, approve or merge anything.",
    requires: ["github"],
  },
  {
    id: "standup",
    name: "Standup notes from Linear",
    outcome: "Weekdays at 9:30: yesterday, today and blockers, from your Linear issues.",
    category: "Engineering",
    trigger: { type: "schedule" },
    schedule: "30 9 * * 1-5",
    prompt:
      "Write my standup from Linear: issues assigned to me that changed state since yesterday (done), what's in progress now (today), and anything blocked or overdue (blockers). Three short lists. Don't update any issues.",
    requires: ["linear"],
  },
  {
    id: "bug-reports-to-linear",
    name: "Bug reports to Linear issues",
    outcome: "Bug reports that arrive by email become Linear issues, after your OK.",
    category: "Engineering",
    trigger: { type: "gmail", query: "subject:(bug OR broken OR error OR crash)" },
    prompt:
      "If this email reports a bug in our product, search Linear for an existing issue about it. If there is one, tell me which. If not, propose creating a Linear issue with a clear title, steps to reproduce, expected vs actual behaviour, and who reported it (no email addresses in the issue). If it isn't a bug report, do nothing. Don't reply to the sender.",
    requires: ["google", "linear"],
  },
  {
    id: "what-shipped",
    name: "What shipped this week",
    outcome: "Friday at 17: merged PRs and closed issues, written up for the team.",
    category: "Engineering",
    trigger: { type: "schedule" },
    schedule: "0 17 * * 5",
    prompt:
      "Summarise what shipped this week: pull requests merged in the last 7 days in the repositories I work on, grouped by theme, each with a one-line plain-English description and a link. End with notable fixes. Write it in my writing style. Don't post it anywhere.",
    requires: ["github"],
  },
];
