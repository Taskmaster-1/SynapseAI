# Slack

Connecting Slack does two things:

- **Approve from Slack.** When a task needs your OK, Synapse messages you in Slack with
  **Approve**, **Deny** and **Open in Synapse** buttons.
- **Slack tools for the agent, acting as you.** It can search your messages, read the
  channels, DMs and threads you're in, look people up, and post in a channel, a DM or a
  thread under your name.

Whoever runs the server creates one Slack app (about five minutes); after that, each user
connects their own Slack from **Connections → Slack**.

## Approvals

- The bot only sends you direct messages, and only about your own approvals.
- Only the Slack person who connected it can press the buttons. A click is acted on only when
  Slack's request signature checks out, it is less than five minutes old, and the action was
  sent to that person. Button contents are treated as untrusted; ownership is checked again
  when the decision is recorded.
- The message updates wherever you decide (web, phone or Slack): "Approved by you · sending in
  10s", "Denied", "Approved in the web app". Undo stays in the web app.
## Agent tools

Connecting also grants a Slack *user token*, so the agent works as you, with exactly the
access you have:

| Tool | What it does | Default |
|---|---|---|
| `slack_search` | Searches messages (Slack search syntax) and returns channel, author, time, a short excerpt and a permalink | runs |
| `slack_read` | Reads recent messages in a channel or DM, or a whole thread, with paging | runs |
| `slack_list_channels` | Lists the channels you're in, with their ids | runs |
| `slack_find_user` | Finds people by email or name, for their user id | runs |
| `slack_post_message` | Posts as you in a channel, a DM (by user id) or a thread | asks first |

- Message text the agent reads is treated as untrusted, like email: it never directs what the
  agent does, and once the agent has read it, every outward action needs your approval.
- "A read never widens the write": a channel or person the agent only saw inside a Slack
  message it read (not in your own request) is flagged on the approval card as a new
  destination. The card shows where the post goes and the exact text, and says it goes out
  as you.
- Mentions in what the agent reads (`<@U123>`) are shown as names; long messages are cut.
- Connected before these tools existed? Your approvals keep working, and the Slack card on
  **Connections** asks you to reconnect to turn the tools on. If Slack revokes the user token,
  the tools switch off the same way until you reconnect.

## Tokens

- Both tokens are encrypted with `SYNAPSE_SECRET`. Disconnecting deletes them and revokes them
  at Slack: always the user token, and the bot token unless someone else on this server uses
  the same workspace install (Slack issues one bot token per workspace).

## Requirements

Slack must be able to reach your server: `PUBLIC_URL` has to be a public **https** URL
(Slack refuses plain http for interactivity). For local development, use a tunnel such as
`cloudflared tunnel --url http://localhost:3000` and set `PUBLIC_URL` to the tunnel's URL.
The web app forwards `/api/*` to the API server unchanged, which the signature check needs.

## 1. Create the Slack app

Open [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From a manifest**,
pick a workspace, and paste this, replacing `https://synapse.example.com` with your
`PUBLIC_URL`:

```yaml
display_information:
  name: Synapse
  description: Asks before it acts. Approve or deny from Slack.
features:
  bot_user:
    display_name: Synapse
    always_online: false
  app_home:
    messages_tab_enabled: true
    messages_tab_read_only_enabled: true
oauth_config:
  redirect_urls:
    - https://synapse.example.com/api/integrations/slack/callback
  scopes:
    bot:
      - chat:write
      - im:write
      - users:read
    user:
      - search:read
      - channels:history
      - groups:history
      - im:history
      - mpim:history
      - channels:read
      - groups:read
      - im:read
      - mpim:read
      - users:read
      - users:read.email
      - chat:write
settings:
  interactivity:
    is_enabled: true
    request_url: https://synapse.example.com/api/slack/interactions
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

Already have the app from an earlier version? Add the `user` scopes above under **OAuth &
Permissions → User Token Scopes** (or update the manifest); everyone then reconnects once.

To let people in other workspaces connect, turn on **Manage Distribution → Activate Public
Distribution**. For a single workspace this isn't needed.

## 2. Configure the server

From **Basic Information → App Credentials**:

```sh
SLACK_CLIENT_ID=1234567890.1234567890
SLACK_CLIENT_SECRET=...
SLACK_SIGNING_SECRET=...
```

All three are required. Restart the server; the Connections page now shows **Connect Slack**.
Connect, then press **Send a test DM** to check that messages arrive.

## Troubleshooting

- **Buttons do nothing / "This app responded with status code 401"**: the signing secret is
  wrong, or the server clock is more than five minutes off.
- **"Slack refused the message (invalid_auth)"**: the app was uninstalled or reinstalled with a
  new token. Disconnect and connect again.
- **The agent has no Slack tools**: the Slack card says to reconnect. The connection has no
  user token, usually because the app lacks the user scopes (see step 1) or it was connected
  before the tools existed.
- **No message for an approval**: check the Slack card says Connected. Approvals go to the
  people who should decide them; each needs their own Slack connected.
