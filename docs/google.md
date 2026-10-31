# Gmail, Google Calendar, Drive and Contacts

Synapse has Gmail, Google Calendar, Google Drive and Google Contacts built in. Whoever runs the
server creates one Google OAuth app (about five minutes); after that, each user connects their
own account from **Connections → Google**. The same app also enables "Sign in with Google".

Tokens are encrypted with `SYNAPSE_SECRET` and never leave your server. Disconnecting revokes
the grant at Google and deletes them.

## 1. Create the OAuth app

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create a project
   (or pick one).
2. **APIs & Services → Library**: enable the **Gmail API**, the **Google Calendar API**, the
   **Google Drive API** and the **People API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type: **Internal** if everyone is in your Google Workspace; otherwise **External**.
   - Add the scopes `.../auth/gmail.modify`, `.../auth/calendar.events`,
     `.../auth/drive.readonly`, `.../auth/drive.file`, `.../auth/contacts.readonly` and
     `.../auth/contacts.other.readonly`.
   - For an External app in testing mode, add each person's address under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs, with your `PUBLIC_URL`:
     - `https://synapse.example.com/api/integrations/google/callback` (Gmail, Calendar, Drive, Contacts)
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
| `calendar_find_free_time` | read | allowed |
| `calendar_create_event`, `calendar_update_event`, `calendar_respond` | send (guests are notified) | asks |
| `calendar_delete_event` | destructive | asks |
| `drive_search`, `drive_read` | read | allowed |
| `drive_create_doc` | write | asks |
| `contacts_search` | read | allowed |

Email bodies, calendar details and Drive files are third-party content: reading them taints the
run, and from then on nothing but reads is auto-allowed, whatever your rules say. Change the
defaults for your account under **Settings → Approval rules**, for example
`{ "tool": "gmail_send", "decision": "allow", "when": [{ "path": "to", "op": "allEndWith", "value": ["@acme.com"] }] }`.

A few details:

- **Free time.** `calendar_find_free_time` takes a meeting length, a date range and working
  hours, and returns open slots in your calendar's time zone (or one you name), skipping
  weekends, events you declined and events marked "free". It only sees your own calendar:
  Google's free/busy lookup for colleagues needs a broader calendar scope than
  `calendar.events`, so for other guests it says their availability is unknown. It returns
  times only, never event text, so it doesn't taint the run.
- **Drive.** `drive_read` exports Google Docs and Slides as text and Sheets as CSV (the first
  sheet), extracts the text of PDFs and text files, and pages through long files 12,000
  characters at a time. Photos and other binary files come back as a note.
  `drive_create_doc` turns light Markdown (headings, lists, bold, links) into a new private
  Google Doc and returns its link; the approval card shows the title and the full text.
- **Contacts.** `contacts_search` looks in your saved contacts and in "other contacts" (people
  you've emailed), and returns only names, addresses and phone numbers. Its results count as
  your own data, not outside content, so "email Sam" looks Sam up and goes to the normal
  approval for `gmail_send`, without a "new recipient" warning.

## Connections made before Drive and Contacts

Gmail and Calendar are required to connect; Drive and Contacts are not. An account connected
before those tools existed (or one where someone unticked a box on Google's consent screen)
keeps working for mail and calendar, the Drive or Contacts tools are simply left out, and the
Connections page offers **Reconnect Google** to add them. The agent is told which ones are
missing, so it can say so instead of guessing.

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
| `calendar.events` | Read and change events on calendars you can edit, and find free time |
| `drive.readonly` | Search and read files in your Drive |
| `drive.file` | Create Google Docs (and change only files this app created) |
| `contacts.readonly` | Search your saved contacts |
| `contacts.other.readonly` | Search "other contacts": people you've emailed |

Google classifies `gmail.modify` and `drive.readonly` as restricted scopes. For an **Internal**
app, or an External app in testing mode with up to 100 test users, no review is needed, which
covers self-hosting for yourself or your team. Offering them to the public on your own app
requires Google's verification (and, for restricted scopes, a security assessment).
