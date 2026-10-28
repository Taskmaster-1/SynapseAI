# Team workspaces

A team workspace lets a company put its people under one set of approval rules, send risky
actions to an admin for sign-off, and export an audit log. It is deliberately small:

- **Shared:** the team's rules, its members and roles, invite links, the audit log.
- **Personal, always:** tasks and their history, connections and integrations, memory,
  knowledge, models, keys and budgets. Admins never open a member's task; they see the one
  action that needs them.

One person belongs to at most one workspace. Create one in **Settings → Team** (you become
its owner), then invite people with a link.

## How team rules combine with yours

Every proposed tool call is checked against your own policy (your rules, then your defaults)
and against your team's rules, separately. The **strictest** answer wins:

```
block  >  ask, an admin decides  >  ask  >  allow
```

| Team says | You say | Result |
|---|---|---|
| block | anything | **block**. A team block can never be overridden |
| ask, an admin decides | allow / ask | **ask, and a team admin decides** (not you) |
| ask | allow | ask (you decide) |
| allow | ask (rule or default) | ask: a team allow never loosens your own policy |
| no matching rule | anything | your policy decides |
| anything | block | block |

Details:

- Team rules have no defaults. A team rule that doesn't match has no opinion, so with no
  matching team rule your policy decides exactly as it would without a team.
- Within the team's rules, a matching `block` wins outright, otherwise the first matching
  rule, just like personal rules.
- **Outside content** still escalates: once a task has read an email, a web page or a
  document, a combined `allow` of anything but a read becomes an ordinary `ask`. A stricter
  answer (block, or an admin's ask) stays as it is.
- **Approved plans** (`propose_plan`): a step you approved runs without asking again when
  the call matches it exactly. That stands in for *your* approval, so it satisfies an
  ordinary ask (yours or the team's), but never a block and never an ask that needs an
  admin.
- **Edits:** when you (or an admin) approve with edited input, the edit is checked again. An
  edit the rules would block is refused, and so is one that would turn an ordinary ask into
  one that needs an admin.

The composition is `evaluateComposedPolicy` in `packages/core/src/policy.ts`; with no team
rules it returns exactly what `evaluatePolicy` does.

## When an admin must decide

A team rule `{ "tool": "gmail_send_*", "decision": "ask", "approver": "admin" }` means a
team owner or admin signs off, not the member whose task asked:

- The member sees the action as **Waiting for an admin**, with no Approve or Deny. Sending
  a new message to the task still withdraws it, as with any pending approval.
- Owners and admins see it in their inbox under **Needs an admin**, with the member's name.
  Approving or denying works like any approval; the member's task then continues, and
  `decided_by` records the admin.
- If the member is an owner or admin themselves, they may decide their own.
- Notification channels (push, email, Slack) deliver it to the team's owners and admins
  instead of the member.
- If the member leaves the team while it waits, the team's rules no longer govern them and
  they decide it themselves.

## Approvals that don't wait forever

Pending approvals get one reminder, escalate to the team, and finally expire. A sweeper in
the worker loop (every 30 seconds, on every worker) does this; each step is claimed with a
compare-and-set on its own timestamp (`reminded_at`, `escalated_at`, the expiry itself), so
any number of workers can sweep at once and each step happens exactly once.

| Step | Default | Set in | What happens |
|---|---|---|---|
| Remind | 30 min | Settings → Notifications (per person) | One more notification, through the same channels, to whoever can decide it |
| Escalate | 60 min | Settings → Team → Approvals | A member's approval also goes to the team's owners and admins, who may now decide it. The member still can. Calls that need an admin are with admins from the start and don't escalate |
| Expire | 24 h | Settings → Notifications, or team-wide in Settings → Team | Denied with "Expired: nobody decided in time". The agent sees that as the tool result and the run continues, like any deny |

Times count from when people were first told (`notified_at`). The expiry is fixed when an
approval starts waiting, so changing the setting affects new approvals only. `0` turns a
step off (expiry: never). Personal accounts have no escalation.

## Two-person sign-off

**Settings → Team → Approvals → Two-person sign-off** makes irreversible actions (and,
optionally, anything that sends) need two different people:

- **Who:** the member and any owner or admin, in either order; or, when a team rule says an
  admin decides, two different admins (a requester who is an admin can be one of them).
  Nobody can give both approvals: a second approval from the same person is refused
  (`409 already_approved`).
- **First approval:** recorded (`first_approved_by`, `_at`, `_via`) and the action keeps
  waiting, shown as "1 of 2 approvals". The other people who may give the second approval
  are notified.
- **Second approval:** completes it. Only now does the requester's undo window start, and
  the requester can still undo inside it.
- **Any deny** ends it, including from the first approver.
- **Edits:** an approval with edited input stores the edit, so the next person sees and
  approves exactly what will run. An edit counts as the editor's approval only: any earlier
  approval of the old input is set aside and one more person must approve. Both approvals
  always cover the same input.
- It works the same from the web app, push notifications and Slack (all go through one
  decision path). Expiry still applies.

A team whose only owner or admin is one person can't give that person's own actions a
second approval: they will expire. Make someone else an admin.

## Roles

| | Owner | Admin | Member |
|---|:-:|:-:|:-:|
| See the team, its members and rules | ✓ | ✓ | ✓ |
| Leave | ✓ (not the last owner) | ✓ | ✓ |
| Decide team members' "an admin decides" actions | ✓ | ✓ | |
| Decide members' escalated actions, give the second of two approvals | ✓ | ✓ | |
| Change escalation, team expiry, two-person sign-off | ✓ | ✓ | |
| Rename the team | ✓ | ✓ | |
| Create and revoke invite links | ✓ | ✓ | |
| Change members' and admins' roles, remove them | ✓ | ✓ | |
| Make someone an owner, change or remove an owner | ✓ | | |
| Edit team rules | ✓ | ✓ | |
| Export the audit log | ✓ | ✓ | |

A team always keeps at least one owner: the last owner can't step down or leave while
others remain (make someone else owner first). The last person to leave deletes the team.

## Invites

An invite is a link, `https://<your-synapse>/join/<token>`, shown once when it's created.
Send it however you like. It works once, expires after 7 days, and can be revoked. Only a
SHA-256 of the token is stored. Whoever opens it signs in (or signs up), sees what joining
means, and clicks **Join team**. Invites can make members or admins, never owners.

## Audit export

Owners and admins can download a CSV (**Settings → Team → Audit log**, or
`GET /api/workspace/audit.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`) of every action proposed in
members' tasks while they were in the team:

| Column | |
|---|---|
| `time` | When the agent proposed it (ISO 8601, UTC) |
| `member` | The member's email |
| `task` | The task's title |
| `tool` | Tool name |
| `effect` | read, write, send or destructive |
| `decision` | What the rules said: allow, ask or block |
| `status` | What happened: succeeded, failed, denied, awaiting_approval… |
| `decided_by` | Email of the person who approved or denied (empty when the rules decided, or it expired). With two-person sign-off, the second approver |
| `decided_via` | Where they decided: web, push, slack, email; `expiry` when nobody decided in time |
| `reason` | Why the rules said so |
| `first_approved_by` | Two-person sign-off: email of the first approver |
| `first_approved_via` | Where they approved |
| `reminded_at` | When the reminder went out, if it did |
| `escalated_at` | When it escalated to the team's admins, if it did |

The file is RFC 4180 CSV. Task titles and reasons can contain text that came from outside
(an email subject, say), so any cell starting with `=`, `+`, `-` or `@` is prefixed with `'`
to stop spreadsheets from running it as a formula. Ranges are capped at a year and 50,000
rows per export.
