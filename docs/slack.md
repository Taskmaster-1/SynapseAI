# Approve from Slack

When a task needs your OK, Synapse can message you in Slack with **Approve**, **Deny** and
**Open in Synapse** buttons. Whoever runs the server creates one Slack app (about five
minutes); after that, each user connects their own Slack from **Connections → Slack**.

What it can and can't do:

- It only sends you direct messages, and only about your own approvals. It can't read your
  channels or messages.
- Only the Slack person who connected it can press the buttons. A click is acted on only when
  Slack's request signature checks out, it is less than five minutes old, and the action was
  sent to that person. Button contents are treated as untrusted; ownership is checked again
  when the decision is recorded.
- The message updates wherever you decide (web, phone or Slack): "Approved by you · sending in
  10s", "Denied", "Approved in the web app". Undo stays in the web app.
- The bot token is encrypted with `SYNAPSE_SECRET`. Disconnecting deletes it and revokes it at
  Slack (unless someone else on this server uses the same workspace install, since Slack issues
  one bot token per workspace).

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
settings:
  interactivity:
    is_enabled: true
    request_url: https://synapse.example.com/api/slack/interactions
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

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
- **No message for an approval**: check the Slack card says Connected. Approvals go to the
  people who should decide them; each needs their own Slack connected.
