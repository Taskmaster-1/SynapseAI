# Design

SynapseAI's UI is an **agent workspace**: you hand off tasks, watch them happen, and
decide on anything that acts in the world. Two ideas drive every screen:

1. **Approvals are the hero.** The most important moment in the product is "the agent
   wants to send/change/delete something — yes or no?" It must be instantly legible: what
   exactly will happen, where, and why we're asking.
2. **Calm transparency.** Everything the agent did is visible (activity timeline, cost,
   which tools, whether it read untrusted content) but quiet until you look.

## Visual language

- **Feel:** warm, editorial, quiet. Paper-like neutrals, one confident ink accent, amber
  reserved for "needs you". No gradients, no glassmorphism, no emoji in chrome.
- **Type:** Geist (UI, variable, self-hosted via `@fontsource-variable/geist`),
  Instrument Serif (display: greetings, page titles, empty states) via `next/font/google`
  (downloaded at build, self-hosted), Geist Mono for code and arguments.
  Scale (px): 12 / 13 / 14 (base) / 16 / 20 / 28 / 40 (serif display). Line-height 1.5
  body, 1.2 headings. Tabular numbers for money and counts.
- **Colour tokens** (CSS variables on `:root`, dark via `prefers-color-scheme` and a
  `data-theme` override):

  | Token | Light | Dark | Use |
  |---|---|---|---|
  | `--canvas` | `#F6F5F1` | `#0F0F0E` | app background |
  | `--surface` | `#FFFFFF` | `#181816` | cards, panels |
  | `--sunken` | `#EFEDE7` | `#0B0B0A` | inputs, code, wells |
  | `--line` | `#E5E2DA` | `#272623` | hairlines |
  | `--line-strong` | `#D3CFC4` | `#3A3833` | input borders, focus-adjacent |
  | `--fg` | `#1B1A17` | `#ECEAE4` | primary text |
  | `--fg-muted` | `#69655C` | `#A39F95` | secondary text |
  | `--fg-faint` | `#9A9589` | `#6E6A61` | meta, placeholders |
  | `--accent` | `#3B48CC` | `#8B95FF` | primary actions, links, focus ring |
  | `--accent-soft` | `#ECEDFB` | `#1E2140` | selected rows, accent wells |
  | `--attention` | `#B45309` | `#F0A23B` | approvals, "needs you" |
  | `--attention-soft` | `#FBF1E2` | `#2A1F10` | approval card wash |
  | `--danger` | `#B42318` | `#F97066` | destructive, deny, errors |
  | `--danger-soft` | `#FCEBE9` | `#2C1513` | |
  | `--ok` | `#18794E` | `#4CC38A` | success |
  | `--ok-soft` | `#E7F5EE` | `#10251B` | |

  Effect colours: read = `--fg-muted` on `--sunken`; write = accent; send = attention;
  destructive = danger.
- **Shape & depth:** radius 12 (cards), 8 (controls), 999 (pills). Hairline borders over
  shadows; one elevation shadow for popovers: `0 12px 32px -12px rgb(0 0 0 / .18)`.
- **Motion:** 140–180 ms ease-out. New timeline rows slide in 4 px and fade; streaming text
  has a soft caret; a newly requested approval card gets one gentle amber glow. Respect
  `prefers-reduced-motion`.
- **Icons:** lucide-react, 16 px, 1.75 stroke. Connections get a monogram tile (first
  letter on a tinted square) — no third-party logos in the repo.
- **Brand mark:** a small "synapse" glyph — two dots joined by a curve — next to the
  wordmark "Synapse" (set in Geist, medium).

## Layout

```
┌──────────┬──────────────────────────────────────┬────────────────┐
│ Rail     │ Main                                 │ Run panel      │
│ 248px    │ max-width 760 content, centered      │ 360px, toggle  │
└──────────┴──────────────────────────────────────┴────────────────┘
```

- **Rail:** brand · "New task" button (⌘K opens the command palette; "N" starts a new
  task) · Home · Inbox (amber count) · Automations · Knowledge · Connections · section
  "Tasks" (search + recent tasks with status dot, title, relative time; amber dot when
  waiting) · footer: Activity, Settings, account menu (name, today's spend, theme,
  sign out).
- **Run panel** (task view only): tabs **Activity** and **Details**. Collapsible; below
  1200 px it becomes a slide-over toggled from the task header; on mobile a bottom sheet.
- **Mobile (< 768 px):** rail becomes a top bar with a menu drawer plus a bottom tab bar
  (Home, Inbox, Tasks, More). Content gutters 16 px. No horizontal scroll anywhere.

## Screens

### Home `/`
- Serif greeting: "Good morning, Ada." and a muted line: "3 things need you · 2 tasks
  running · $0.42 today".
- Big composer card ("What should I take care of?"), suggestion chips derived from active
  connections (e.g. github → "Triage my open PRs"), Enter to start a task.
- **Needs you:** compact approval cards (preview line, effect pill, task title,
  Approve / Review), max 3, "Open inbox" link.
- **Recent tasks:** rows with status, title, snippet (markdown stripped), time, cost.
- **Scheduled:** automations with next run ("Weekdays 9:00 · in 14h").
- Empty states teach: no connections → "Connect GitHub, Linear or any MCP server".

### Task `/t/[id]` (old `/c/[id]` redirects)
- Header: editable title, status pill (Running / Needs you / Done / Failed / Stopped),
  taint shield (amber shield icon + tooltip "Read outside content — actions need
  approval") when `tainted`, Stop button while active, run-panel toggle, ⋯ menu (rename,
  delete).
- Conversation: user messages are right-aligned soft bubbles; agent messages are full
  width with no bubble. Tool calls render as a compact **step group** inline ("Used 2
  tools · gmail, linear ▸") that expands to rows; the full story lives in the Activity tab.
  Handover rows render as a divider "Earlier conversation summarised".
- **Approval card** (inline, and identical in Inbox):
  - Eyebrow: amber dot + "Needs your approval".
  - Title: the tool's `preview` ("Email bob@acme.com — “Re: Sync tomorrow?”"), falling back
    to a humanised tool name ("gmail · Send email").
  - Meta row: connection monogram + name, effect pill, the `reason` sentence. If the run is
    tainted, the shield and the taint sentence lead.
  - **Payload, not JSON:** render the input as labelled fields. Strings with newlines
    render as preserved-whitespace text blocks; recognise email-like shapes
    (`to`/`cc`/`subject`/`body`) and render them like an email; arrays as chips; nested
    objects as indented groups; a "View raw" toggle shows pretty JSON.
  - **Edit** turns fields into inputs/textareas in place (raw JSON editor for anything
    nested), with "Edited" badge; Approve sends the edited input.
  - Actions: **Approve** (primary, ⌘↵), **Deny** (opens an inline reason field, Enter to
    send), and a quiet "Always allow…" link to Settings → Approval rules prefilled with the
    tool name.
  - After the decision: card collapses to a one-line receipt ("Approved by you · sent" /
    "Denied: <reason>").
- Composer pinned at the bottom: auto-growing textarea, Enter to send, Shift+Enter newline;
  while a run is active the button reads "Queue" with hint "The agent will read this at
  its next step".
- **Activity tab:** vertical timeline of steps: icon (connection monogram or built-in
  icon), preview/humanised name, effect pill, status (spinner / check / amber / x /
  question mark for `unknown`), duration; click expands input and output (output
  truncated with "Show all"). Taint event marked ("Read outside content here").
- **Details tab:** model, steps, tokens in/out, cost, started/finished, trigger, policy
  decisions summary (n allowed automatically, n approved, n denied).

### Inbox `/inbox`
Two-pane: list on the left (grouped by task, newest first, preview + effect + age),
selected approval on the right (full approval card + the task's last agent message for
context + "Open task"). Keyboard: `j`/`k` move, `a` approve, `d` deny, `e` edit. Empty
state in serif: "All clear." with a muted line about what lands here.

### Automations `/automations`
Cards: name, prompt excerpt, human schedule ("Weekdays at 9:00 (UTC)") with the cron in
mono beside it, next/last run, enabled switch, Run now, Edit. Editor in a side sheet with
schedule presets and a live "Next 3 runs" preview computed client-side for presets.

### Knowledge `/knowledge`
Tabs **Documents** (drop zone, list, search with highlighted passages) and **Memory**
(notes list with source "You"/"Agent", inline edit, add).

### Connections `/connections`
Grid of connection cards (monogram, name, URL host, status pill, tools count) → detail
sheet listing tools with effect selector per tool and a short explainer of effects.
"Add connection" sheet: presets grid + custom URL/token form. OAuth "Authorize" flow and
`?connected=` / `?error=` toasts.

### Settings `/settings`
Left section nav: General (name, instructions), Models & keys, Budgets, Approval rules,
Appearance (theme). **Approval rules** reads like sentences: "When **gmail · send email**
and **to** ends with **@acme.com** → **Allow**", drag to reorder, defaults per effect as a
segmented control.

### Activity `/activity`
Usage summary (today, 7 days, 30 days spend; small bar chart of daily spend), runs table
(status, task, trigger, model, steps, tokens, cost, time) with a detail sheet showing the
tool-call audit trail (who decided, when, reason).

### Sign in / Sign up
Split layout: left panel (surface, serif headline "An agent that asks before it acts.",
a static mock approval card as illustration), right the form. Single column on mobile.

## Interaction details

- Command palette (⌘K / Ctrl+K): New task, go to any page, search tasks by title.
- Toasts bottom-right (bottom-center on mobile), auto-dismiss 4 s, never for errors that
  need action.
- Focus rings: 2 px accent outline with 2 px offset. Everything reachable by keyboard.
- Numbers: money `$0.04` (under $0.01 → "<$0.01"), tokens `12.3k`, times relative ("2m
  ago") with absolute on hover.
- Loading: skeletons that match the final layout; never spinners for whole pages.
