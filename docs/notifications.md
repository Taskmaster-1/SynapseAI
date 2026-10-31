# Notifications: approve from your phone

When a task stops to ask, Synapse can tell you where you are:

- **Web Push** to your phone or desktop, with **Approve** and **Deny** right on the
  notification. Works in the installed app (Home Screen on iOS and Android) and in desktop
  browsers.
- **Email alerts**, optional per person, with a link to the task.

Each approval is announced once, when the run starts waiting. Several approvals at once
become one summary notification per person.

The same channels (push, Slack DM, and email when email alerts are on) also deliver
reminders you asked the agent for ("remind me Friday at 9 to send the report"): a plain
notification with the reminder and a link to the conversation. See
[scheduled from chat](api.md#scheduled-from-chat).

## Reminders, escalation and expiry

If nobody decides, the same channels hear about it again, once each:

- **Reminder** (default after 30 minutes; Settings → Notifications → When nobody decides):
  "Reminder: Synapse still needs your OK". In Slack, the original message is refreshed (its
  buttons stay) and a reply in its thread does the nudging.
- **Escalated** (team workspaces, default after 60 minutes): the team's owners and admins
  get it too, and may decide it.
- **Needs a second approval** (two-person sign-off): after the first approval, the others
  who may give the second one are told.
- **Expired** (default after 24 hours): it is denied as "Expired: nobody decided in time";
  Slack messages are rewritten to say so.

Every notification carries up to three plain-language risk facts ("Sends to 2 people
outside acme.com", "Can't be undone", "After reading outside content"), how long until it
expires, and two-person progress. See [teams](teams.md) for escalation and two-person
sign-off.

## Web Push

### 1. VAPID keys

Push services only accept messages signed with your server's VAPID key pair. Generate one:

```bash
bunx web-push generate-vapid-keys
```

and set:

```bash
VAPID_PUBLIC_KEY=BK...        # "Public Key"
VAPID_PRIVATE_KEY=...         # "Private Key", keep it secret
VAPID_SUBJECT=mailto:you@example.com   # how push services can reach you; required in production
```

In development (`NODE_ENV=development`, the default) you can skip this: the server generates a
pair once and keeps it in `.data/vapid.json`, next to the dev secret. Production never generates
keys; push stays off until they are set.

Keep the pair stable. Changing it invalidates every device's subscription: people have to turn
notifications on again in Settings.

### 2. HTTPS and the service worker

Push needs a secure origin: `https://`, or `http://localhost` while developing. The web app
registers its service worker (`/sw.js`) in production builds. To try it under `next dev`, set
`NEXT_PUBLIC_ENABLE_SW=true` for the web app (on localhost, so the browser treats it as secure).

The worker caches nothing and never intercepts requests: it only shows notifications and
handles their buttons.

### 3. Turn it on

**Settings → Notifications → Turn on.** The browser asks for permission and the device appears
under "Your devices". **Send a test** checks the whole path. Each person turns it on per
device; remove old devices from the same list.

### iPhone and iPad

iOS and iPadOS (16.4 and later) deliver Web Push only to apps on the Home Screen:

1. Open Synapse in Safari.
2. Tap **Share → Add to Home Screen**.
3. Open Synapse from the Home Screen, sign in, and turn notifications on in Settings.

iOS does not show notification buttons, so tapping a notification opens the task, where you
approve or deny. Android, Windows, macOS Chrome/Edge/Firefox show **Approve** and **Deny**.

### Approving from the lock screen

**Approve** and **Deny** call the same decision API as the app, with your session cookie, and
are recorded with `decided_via = "push"`. If that fails (you were signed out, someone already
decided, you're offline) the task opens instead.

Sends and deletes still wait out your undo window (Settings → General, 10 seconds by
default): the notification turns into "Approved · sending in 10s" with an **Undo** button. If
your undo window is off, a send or delete can't be approved from a notification; it offers
**Deny** only, and tapping opens the task.

### What is sent

The payload is encrypted end to end to the device (the push service can't read it) and holds
the action's one-line preview, the task link and ids, never the full input. Notifications
expire after 24 hours if the device is offline. When a push service says a device is gone
(HTTP 404/410) its subscription is deleted.

For safety the server only delivers to known push services (Google FCM, Mozilla, Apple, Windows
WNS) over HTTPS; other endpoints are refused when a device subscribes.

## Email alerts

Set an SMTP server and a sender:

```bash
SMTP_URL=smtps://user:password@smtp.example.com:465   # or smtp://…:587 for STARTTLS
EMAIL_FROM=Synapse <synapse@example.com>
```

Then each person can turn on **Settings → Notifications → Email me when something needs my
OK**. Alerts go to the account's email address and contain the preview, why Synapse is asking,
and a link to the task, in plain text and simple HTML.

There are **no approve or deny links** in email, on purpose: mail security scanners open every
link in a message, so a one-click link would approve things nobody looked at. You decide in the
app.

## Environment

| Variable | |
|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push key pair; both or neither. Dev generates one if unset |
| `VAPID_SUBJECT` | `mailto:` address or `https://` URL; required with keys in production |
| `SMTP_URL` | SMTP connection URL for email alerts |
| `EMAIL_FROM` | Sender for email alerts; email is on only when this and `SMTP_URL` are set |
| `NEXT_PUBLIC_ENABLE_SW` | Web app: register the service worker under `next dev` |
