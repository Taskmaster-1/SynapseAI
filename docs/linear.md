# Linear

Synapse has Linear built in: the agent can search and read issues, list what's assigned to
you, file new issues, move and reassign them, and comment, all as you. Whoever runs the
server creates one Linear OAuth app (about two minutes); after that, each user connects
their own Linear from **Connections → Linear**.

Tokens are encrypted with `SYNAPSE_SECRET` and never leave your server. Disconnecting revokes
them at Linear and deletes them.

Prefer Linear's hosted MCP server? It is still in the **Add connection** presets. The built-in
tools add tailored approval cards, plain-language risk facts and the "a read never widens the
write" check on teams and issues; you can use either, or both.

## 1. Create the OAuth app

1. In Linear, open **Settings → API → OAuth applications → New OAuth application**
   (workspace admins only).
2. Fill in a name (e.g. "Synapse") and a developer URL.
3. **Callback URLs**: `https://synapse.example.com/api/integrations/linear/callback`, with your
   `PUBLIC_URL`. For local development, `http://localhost:3000/api/integrations/linear/callback`
   works too.
4. To let people in other Linear workspaces connect, turn on **Public**. For one workspace
   this isn't needed.
5. Save, then copy the **Client ID** and **Client secret**.

Synapse asks for the `read` and `write` scopes. Linear's narrower `issues:create` and
`comments:create` can't move or reassign issues, so they aren't enough for the tools. The
sign-in uses PKCE, and the person is the actor (`actor=user`): everything the agent does
shows up in Linear under their name.

## 2. Configure the server

```sh
LINEAR_CLIENT_ID=...
LINEAR_CLIENT_SECRET=...
```

Both are required. Restart the server; the Connections page now shows **Connect Linear**.

## What the agent can do

| Tool | What it does | Default |
|---|---|---|
| `linear_search` | Searches issues by text, optionally by team key, state or assignee ("me", an email, a name) | runs |
| `linear_read` | Reads one issue by identifier (`ENG-123`) or link: state, priority, assignee, labels, project, cycle, description and the latest comments | runs |
| `linear_my_issues` | Lists the issues assigned to you, grouped by state; open ones unless asked for all | runs |
| `linear_list_teams` | Lists your teams with their keys, workflow states and labels | runs |
| `linear_create_issue` | Files an issue in a team (key or id): title, markdown description, priority, assignee, labels, state | asks first |
| `linear_update_issue` | Moves an issue to another state, reassigns or unassigns it, sets priority, renames it, adds or removes labels | asks first |
| `linear_comment` | Comments on an issue | asks first |

- Issue titles, descriptions and comments are written by other people, so they are treated
  as untrusted, like email: they never direct what the agent does, and once the agent has
  read them, every outward action needs your approval. `linear_list_teams` returns only ids
  and names set inside your workspace, so it doesn't count as outside content.
- "A read never widens the write": a team or issue the agent only saw inside Linear content
  (not in your own request) is flagged on the approval card as a new destination.
- The approval card shows a new issue as it will be filed (team, title, priority, labels,
  description) and a comment as it will appear, and says both go out as you.
- Team, state, label and person names are resolved to Linear ids when the action runs; an
  unknown name fails with the list of valid ones, so the agent can correct itself.
- Long descriptions are cut at 4,000 characters and comments at 800; `linear_read` returns the
  ten most recent comments.

## Tokens

- Linear access tokens last 24 hours. Synapse refreshes them with the refresh token, and saves
  the new refresh token Linear issues each time.
- OAuth apps created before Linear introduced refresh tokens get long-lived access tokens with
  no refresh token; those keep working until Linear expires them, then the card asks you to
  reconnect.
- If Linear rejects the token (you revoked the app under **Settings → Account → Security &
  access**, or an admin removed it), the Linear tools switch off and the card shows **Needs
  authorization** with a **Reconnect Linear** button.

## Troubleshooting

- **"Linear did not grant write access"**: the app was approved with `read` only. Connect again
  and approve both.
- **"Linear's rate limit was reached"**: Linear limits requests per person per hour. The
  agent is told when to try again; nothing was changed.
- **The agent has no Linear tools**: check the Linear card says Connected. **Needs
  authorization** means the grant was revoked or expired; reconnect.
