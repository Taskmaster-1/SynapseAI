# Gmail and Google Calendar

Synapse has Gmail and Google Calendar built in. Whoever runs the server creates one Google
OAuth app (about five minutes); after that, each user connects their own account from
**Connections → Gmail and Calendar**. The same app also enables "Sign in with Google".

Tokens are encrypted with `SYNAPSE_SECRET` and never leave your server. Disconnecting revokes
the grant at Google and deletes them.

## 1. Create the OAuth app

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project
   (or pick one).
2. **APIs & Services → Library**: enable the **Gmail API** and the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type: **Internal** if everyone is in your Google Workspace; otherwise **External**.
   - Add the scopes `.../auth/gmail.modify` and `.../auth/calendar.events`.
   - For an External app in testing mode, add each person's address under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs, with your `PUBLIC_URL`:
     - `https://synapse.example.com/api/integrations/google/callback` (Gmail and Calendar)
     - `https://synapse.example.com/api/auth/callback/google` (Sign in with Google, optional)
   - For local development, `http://localhost:3000/...` works too.

## 2. Configure the server

```sh
GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

Restart the server. The Connections page now shows **Connect Google**.

## What the agent can do

| Tool | Effect | Default |
|---|---|---|
| `gmail_search`, `gmail_read_thread` | read | allowed |
| `gmail_create_draft` | write | allowed until the run has read email (drafts stay in your mailbox) |
| `gmail_organize` (labels, archive, read/unread, star) | write | asks |
| `gmail_send` (new mail or in-thread reply) | send | asks |
| `gmail_trash` | destructive | asks |
| `calendar_list_events` | read | allowed |
| `calendar_create_event`, `calendar_update_event`, `calendar_respond` | send (guests are notified) | asks |
| `calendar_delete_event` | destructive | asks |

Email bodies and calendar details are third-party content: reading them taints the run, and
from then on nothing but reads is auto-allowed, whatever your rules say. Change the defaults
for your account under **Settings → Approval rules**, for example
`{ "tool": "gmail_send", "decision": "allow", "when": [{ "path": "to", "op": "allEndWith", "value": ["@acme.com"] }] }`.

## Email triggers

With Google connected, an automation can start **when email arrives**. Give it a Gmail search
(`from:@customer.com`, `subject:(invoice OR receipt)`, `is:important`) or leave it empty for
the whole inbox. Every new matching email starts its own task, with the sender, subject and a
preview attached; the agent reads the full thread with `gmail_read_thread`.

- New mail is checked every `TRIGGER_POLL_SECONDS` (default 120). Polling needs no public
  endpoint or Pub/Sub topic, so it works behind a firewall.
- Only mail that arrives after the trigger is created (or re-enabled) counts, and mail you send
  never fires it.
- At most 10 emails per check per automation start tasks; the rest are picked up next time.
- Triggered tasks start tainted, so a malicious email can't get anything sent, changed or
  deleted without your signature.

## Scopes, and why

| Scope | Used for |
|---|---|
| `openid`, `email` | Showing which account is connected |
| `gmail.modify` | Read, draft, send, label, archive, trash. Not permanent delete. |
| `calendar.events` | Read and change events on calendars you can edit |

Google classifies `gmail.modify` as a restricted scope. For an **Internal** app, or an External
app in testing mode with up to 100 test users, no review is needed. Offering it to the public
on your own app requires Google's verification.
