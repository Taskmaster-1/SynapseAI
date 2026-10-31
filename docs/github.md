# GitHub

Synapse has GitHub built in: the agent can search and read issues and pull requests, check
what's waiting on you, read code, and (with your OK) comment, open issues and close, label or
assign them, all as you. Whoever runs the server sets up a GitHub OAuth app (the one used for
"Sign in with GitHub" works); after that, each user connects their own account from
**Connections → GitHub**.

No MCP server is needed. If you'd rather use GitHub's own MCP server, it's still available
under **Add connection**; you can have both.

## 1. The OAuth app

Use your existing "Sign in with GitHub" app or create one at
[github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps → New
OAuth App** (for an organization: the org's **Settings → Developer settings → OAuth Apps**).

GitHub sends people back only to a callback URL the app knows. The GitHub tools use
`<PUBLIC_URL>/api/integrations/github/callback`; sign-in uses
`<PUBLIC_URL>/api/auth/callback/github`. Either:

- **Add both callback URLs** (OAuth apps take up to 10): in the app's settings, **Add callback
  URL** and enter
  - `https://synapse.example.com/api/auth/callback/github` (Sign in with GitHub, optional)
  - `https://synapse.example.com/api/integrations/github/callback` (GitHub tools)
- **Or use one common prefix**: GitHub accepts a `redirect_uri` that is a subdirectory of a
  registered callback URL on the same host and port, as long as that callback URL has
  subdirectory (wildcard) matching enabled. Register `https://synapse.example.com/api` and both
  paths work. Apps created with a single callback URL before August 2026 have this on by
  default; newer ones may need it turned on, so listing both URLs is the safer choice.

For local development, `http://localhost:3000/...` works too (GitHub recommends
`http://127.0.0.1:3000` for loopback).

If the callback URL doesn't match, GitHub shows "The redirect_uri is not associated with this
application" instead of the consent screen.

## 2. Configure the server

```sh
GITHUB_CLIENT_ID=Ov23li...
GITHUB_CLIENT_SECRET=...
```

Restart the server. The Connections page now shows **Connect GitHub**.

To keep the tools separate from sign-in (a different app name on the consent screen, or a
sign-in app you can't change), create a second OAuth app with only the tools callback URL and
set:

```sh
GITHUB_TOOLS_CLIENT_ID=Ov23li...
GITHUB_TOOLS_CLIENT_SECRET=...
```

Both must be set together; they override `GITHUB_CLIENT_ID`/`SECRET` for the tools only.

## What the agent can do

| Tool | What it does | Effect | Default |
|---|---|---|---|
| `github_search` | Searches issues and pull requests with GitHub search syntax (`repo:acme/web is:open label:bug`, `review-requested:@me`) | read | runs |
| `github_read` | Reads an issue or PR by `owner/repo#123` or URL: title, state, author, labels, assignees, body, latest comments; for PRs also branches, mergeability, changed files with +/- counts, review status and a checks summary | read | runs |
| `github_my_work` | PRs waiting for your review, issues assigned to you, and your own open PRs | read | runs |
| `github_read_file` | Reads a file at a branch, tag or commit (long files are cut, binaries only described), or lists a directory | read | runs |
| `github_comment` | Comments on an issue or PR as you (Markdown; @mentions notify people) | send | asks |
| `github_create_issue` | Opens an issue with title, body, labels and assignees | write | asks |
| `github_update_issue` | Closes (or closes as not planned), reopens, renames, or replaces labels or assignees | write | asks |

- Everything the read tools return (issue and PR text, comments, file contents) is treated as
  untrusted: it never directs what the agent does, and once the agent has read it, every
  outward action needs your approval.
- "A read never widens the write": the repository a write goes to is a destination. A
  repository that only showed up inside something the agent read (say, an issue body saying
  "also file this in other/repo"), and not in your own request, is flagged on the approval
  card as new.
- The approval card shows the comment rendered as GitHub will show it, or the new issue's
  repository, title, labels, assignees and body. The risk line says it goes out as you
  ("Comments as you on acme/web#41") and how many people an @mention notifies.
- Without a type qualifier, `github_search` runs one search for issues and one for PRs and
  merges them (GitHub's search API wants `is:issue` or `is:pr`).

## Errors

- **Token revoked or expired** (401): the connection switches to "Needs authorization", the
  tools are withdrawn, and the GitHub card asks you to reconnect.
- **Rate limits** (403/429 with GitHub's rate-limit headers): the agent is told when the limit
  resets ("resets at 14:05 UTC (in 12 min)") or how long to wait for a secondary limit.
- **Not found** (404): GitHub answers 404 for private repositories you can't see, so the
  message says "not found, or the connected account has no access to it".
- **403 otherwise**: often an organization that requires SSO authorization for the app, or one
  that restricts OAuth app access. An org owner approves the app under the org's **Third-party
  access** settings; with SAML SSO, authorize it from your GitHub **Settings → Applications**.

## Scopes, and why

| Scope | Used for |
|---|---|
| `repo` | Read and write issues, pull requests, comments and code in repositories you can access, public and private |
| `read:org` | See organization repositories and team review requests |

Classic OAuth scopes are coarse: `repo` also covers pushing code, which these tools never do
(no tool writes files, branches or merges). For narrower access, a GitHub App with
fine-grained permissions (Issues: read/write, Pull requests: read/write, Contents: read,
Metadata: read, Checks: read), installed only on chosen repositories, is the alternative. It
isn't supported yet; GitHub's own MCP server with a fine-grained personal access token is an
option today.

## Tokens

- The token is encrypted with `SYNAPSE_SECRET` and never leaves your server. Connections shows
  the GitHub login it acts as.
- Disconnecting deletes it and revokes it at GitHub. With a dedicated tools app
  (`GITHUB_TOOLS_CLIENT_ID`) the whole authorization is deleted
  (`DELETE /applications/{client_id}/grant`); when the app is shared with sign-in, only this
  token is revoked (`DELETE /applications/{client_id}/token`), so signing in keeps working.
- OAuth app tokens don't expire; a token you revoke at GitHub is noticed on the next call.
