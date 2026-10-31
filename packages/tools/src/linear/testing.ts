/**
 * An in-memory stand-in for the slice of Linear Synapse uses: OAuth 2 (code exchange with
 * PKCE, rotating refresh tokens, revoke) and the GraphQL operations the tools send. Every
 * operation the tools send is named, and the fake answers by `operationName` with the
 * variables given, so it checks what was asked without parsing GraphQL. Pass `fake.fetch`
 * as the Linear config's `fetch`.
 */
export interface FakeLinearUser {
  id: string;
  name: string;
  email: string;
}

export interface FakeLinearTeam {
  id: string;
  key: string;
  name: string;
  states: { id: string; name: string; type: string; position: number }[];
  labels: { id: string; name: string }[];
}

export interface FakeLinearIssue {
  id: string;
  identifier: string;
  teamId: string;
  title: string;
  description: string;
  priority: number;
  stateId: string;
  assigneeId: string | null;
  labelIds: string[];
  comments: { body: string; createdAt: string; userId: string }[];
  createdAt: string;
  updatedAt: string;
}

const PRIORITY_LABELS = ["No priority", "Urgent", "High", "Medium", "Low"];

// biome-ignore lint/suspicious/noExplicitAny: GraphQL variables, inspected loosely
type Vars = Record<string, any>;

export function fakeLinearApi(opts: { workspace?: string; urlKey?: string } = {}) {
  const state = {
    workspace: opts.workspace ?? "Acme",
    urlKey: opts.urlKey ?? "acme",
    /** The Linear user the next code exchange signs in as. */
    nextUser: "lu-ada",
    /** Scope the next code exchange grants. */
    grantedScope: "read write",
    /** Lifetime of new access tokens, seconds. */
    expiresIn: 86_400,
    /** False: behave like a legacy app, with no refresh token. */
    refreshTokens: true,
    /** Access tokens, mapped to the user they act as. */
    tokens: new Map<string, string>(),
    /** Refresh tokens, mapped to the user. Each is good for one refresh (rotation). */
    refresh: new Map<string, string>(),
    revoked: [] as string[],
    users: [] as FakeLinearUser[],
    teams: [] as FakeLinearTeam[],
    workspaceLabels: [] as { id: string; name: string }[],
    issues: [] as FakeLinearIssue[],
    /** Answer every GraphQL request with a rate-limit error while true. */
    rateLimited: false,
    /** Requests seen: "token:<grant_type>", "revoke", or a GraphQL operation name. */
    calls: [] as string[],
    /** Variables of each mutation, in order. */
    mutations: [] as { op: string; variables: Vars }[],
  };
  let n = 0;
  const now = () => new Date(Date.UTC(2026, 9, 1, 12, 0, n++)).toISOString();

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  const gqlError = (message: string, code: string, status = 200) =>
    json({ errors: [{ message, extensions: { code, userPresentableMessage: message } }] }, status);

  const user = (id: string | null) => state.users.find((u) => u.id === id) ?? null;
  const team = (id: string) => state.teams.find((t) => t.id === id)!;
  const stateOf = (i: FakeLinearIssue) => team(i.teamId).states.find((s) => s.id === i.stateId)!;
  const labelOf = (i: FakeLinearIssue, id: string) =>
    [...team(i.teamId).labels, ...state.workspaceLabels].find((l) => l.id === id);
  const teamOut = (t: FakeLinearTeam) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    states: { nodes: t.states },
    labels: { nodes: t.labels },
  });
  const issueOut = (i: FakeLinearIssue) => {
    const t = team(i.teamId);
    const a = user(i.assigneeId);
    return {
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      url: `https://linear.app/${state.urlKey}/issue/${i.identifier}/x`,
      priority: i.priority,
      priorityLabel: PRIORITY_LABELS[i.priority],
      description: i.description,
      state: { name: stateOf(i).name, type: stateOf(i).type },
      assignee: a ? { name: a.name, email: a.email } : null,
      creator: null,
      team: { ...teamOut(t) },
      labels: { nodes: i.labelIds.map((id) => ({ name: labelOf(i, id)?.name ?? id })) },
      project: null,
      cycle: null,
      dueDate: null,
      estimate: null,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
      comments: {
        nodes: i.comments.map((m) => ({
          body: m.body,
          createdAt: m.createdAt,
          user: { name: user(m.userId)?.name ?? "?" },
        })),
      },
    };
  };
  const findIssue = (id: string) =>
    state.issues.find((i) => i.id === id || i.identifier.toLowerCase() === id.toLowerCase());

  /** The subset of Linear's string comparators the tools send. */
  const matches = (value: string, cmp: Vars | undefined) => {
    if (!cmp) return true;
    const v = value.toLowerCase();
    if (cmp.eqIgnoreCase !== undefined) return v === String(cmp.eqIgnoreCase).toLowerCase();
    if (cmp.containsIgnoreCase !== undefined)
      return v.includes(String(cmp.containsIgnoreCase).toLowerCase());
    if (cmp.nin) return !(cmp.nin as string[]).includes(value);
    return true;
  };
  const userMatches = (u: FakeLinearUser | null, f: Vars, me: string): boolean => {
    if (f.or) return (f.or as Vars[]).some((g) => userMatches(u, g, me));
    if (!u) return false;
    if (f.isMe) return u.id === me;
    return matches(u.email, f.email) && matches(u.name, f.name) && matches(u.name, f.displayName);
  };
  const issueMatches = (i: FakeLinearIssue, f: Vars, me: string) =>
    (!f.team || matches(team(i.teamId).key, f.team.key)) &&
    (!f.state ||
      (matches(stateOf(i).name, f.state.name) && matches(stateOf(i).type, f.state.type))) &&
    (!f.assignee || userMatches(user(i.assigneeId), f.assignee, me));

  function issueToken(userId: string) {
    const access = `lin_oauth_${++n}`;
    state.tokens.set(access, userId);
    const out: Record<string, unknown> = {
      access_token: access,
      token_type: "Bearer",
      expires_in: state.expiresIn,
      scope: state.grantedScope,
    };
    if (state.refreshTokens) {
      const refresh = `lin_refresh_${++n}`;
      state.refresh.set(refresh, userId);
      out.refresh_token = refresh;
    }
    return out;
  }

  function graphql(op: string, v: Vars, me: string): Response {
    const viewer = user(me)!;
    switch (op) {
      case "LinearWhoAmI":
        return json({
          data: {
            viewer: { name: viewer.name, email: viewer.email },
            organization: { name: state.workspace, urlKey: state.urlKey },
          },
        });
      case "LinearViewer":
        return json({ data: { viewer: { id: viewer.id, name: viewer.name } } });
      case "LinearUsers": {
        const { active: _, ...f } = v.filter ?? {};
        const hits = state.users.filter((u) => userMatches(u, f, me));
        return json({ data: { users: { nodes: hits.map((u) => ({ id: u.id, name: u.name })) } } });
      }
      case "LinearSearch": {
        const words = String(v.term).toLowerCase().split(/\s+/).filter(Boolean);
        const hits = state.issues.filter(
          (i) =>
            words.every((w) => `${i.title} ${i.description}`.toLowerCase().includes(w)) &&
            issueMatches(i, v.filter ?? {}, me),
        );
        return json({
          data: {
            searchIssues: { totalCount: hits.length, nodes: hits.slice(0, v.first).map(issueOut) },
          },
        });
      }
      case "LinearIssue":
      case "LinearIssueTeam":
      case "LinearIssueId": {
        const i = findIssue(v.id);
        return i
          ? json({ data: { issue: issueOut(i) } })
          : gqlError("Entity not found: Issue", "INVALID_INPUT");
      }
      case "LinearMyIssues": {
        const mine = state.issues
          .filter((i) => i.assigneeId === me && issueMatches(i, v.filter ?? {}, me))
          .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, v.first);
        return json({ data: { viewer: { assignedIssues: { nodes: mine.map(issueOut) } } } });
      }
      case "LinearTeams":
        return json({ data: { teams: { nodes: state.teams.map(teamOut) } } });
      case "LinearTeam": {
        const t = state.teams.find((x) => x.id === v.id);
        return t
          ? json({ data: { team: teamOut(t) } })
          : gqlError("Entity not found: Team", "INVALID_INPUT");
      }
      case "LinearTeamByKey": {
        const k = String(v.key).toLowerCase();
        const hits = state.teams.filter(
          (t) => t.key.toLowerCase() === k || t.name.toLowerCase() === k,
        );
        return json({ data: { teams: { nodes: hits.map(teamOut) } } });
      }
      case "LinearWorkspaceLabels":
        return json({ data: { issueLabels: { nodes: state.workspaceLabels } } });
      case "LinearCreateIssue": {
        state.mutations.push({ op, variables: v });
        const input = v.input as Vars;
        const t = team(input.teamId);
        if (!t) return gqlError("Entity not found: Team", "INVALID_INPUT");
        const issue: FakeLinearIssue = {
          id: `issue-${++n}`,
          identifier: `${t.key}-${100 + state.issues.filter((i) => i.teamId === t.id).length + 1}`,
          teamId: t.id,
          title: input.title,
          description: input.description ?? "",
          priority: input.priority ?? 0,
          stateId: input.stateId ?? t.states.toSorted((a, b) => a.position - b.position)[0]!.id,
          assigneeId: input.assigneeId ?? null,
          labelIds: input.labelIds ?? [],
          comments: [],
          createdAt: now(),
          updatedAt: now(),
        };
        state.issues.push(issue);
        return json({ data: { issueCreate: { success: true, issue: issueOut(issue) } } });
      }
      case "LinearUpdateIssue": {
        state.mutations.push({ op, variables: v });
        const i = findIssue(v.id);
        if (!i) return gqlError("Entity not found: Issue", "INVALID_INPUT");
        const input = v.input as Vars;
        if (input.title) i.title = input.title;
        if (input.stateId) i.stateId = input.stateId;
        if (input.priority !== undefined) i.priority = input.priority;
        if (input.assigneeId !== undefined) i.assigneeId = input.assigneeId;
        if (input.addedLabelIds) i.labelIds = [...new Set([...i.labelIds, ...input.addedLabelIds])];
        if (input.removedLabelIds)
          i.labelIds = i.labelIds.filter((l) => !input.removedLabelIds.includes(l));
        i.updatedAt = now();
        return json({ data: { issueUpdate: { success: true, issue: issueOut(i) } } });
      }
      case "LinearComment": {
        state.mutations.push({ op, variables: v });
        const i = findIssue(v.input.issueId);
        if (!i) return gqlError("Entity not found: Issue", "INVALID_INPUT");
        i.comments.push({ body: v.input.body, createdAt: now(), userId: me });
        return json({
          data: {
            commentCreate: {
              success: true,
              comment: {
                url: `https://linear.app/${state.urlKey}/issue/${i.identifier}#comment-${n}`,
              },
            },
          },
        });
      }
    }
    return gqlError(`Unknown operation ${op}`, "GRAPHQL_VALIDATION_FAILED", 400);
  }

  async function handle(url: URL, init: RequestInit): Promise<Response> {
    const raw = typeof init.body === "string" ? init.body : (init.body?.toString() ?? "");
    if (url.host !== "api.linear.app") return json({ error: "unknown_host" }, 404);
    if (url.pathname === "/oauth/token") {
      const p = new URLSearchParams(raw);
      const grant = p.get("grant_type") ?? "";
      state.calls.push(`token:${grant}`);
      if (p.get("client_secret") !== "lsecret") return json({ error: "invalid_client" }, 401);
      if (grant === "authorization_code") {
        if (!p.get("code") || !p.get("code_verifier")) return json({ error: "invalid_grant" }, 400);
        return json(issueToken(state.nextUser));
      }
      if (grant === "refresh_token") {
        const old = p.get("refresh_token") ?? "";
        const who = state.refresh.get(old);
        if (!who)
          return json(
            { error: "invalid_grant", error_description: "Refresh token is invalid" },
            400,
          );
        state.refresh.delete(old);
        return json(issueToken(who));
      }
      return json({ error: "unsupported_grant_type" }, 400);
    }
    if (url.pathname === "/oauth/revoke") {
      state.calls.push("revoke");
      const token = new URLSearchParams(raw).get("token") ?? "";
      const known = state.tokens.delete(token) || state.refresh.delete(token);
      if (known) state.revoked.push(token);
      return new Response(null, { status: known ? 200 : 400 });
    }
    if (url.pathname !== "/graphql") return json({ error: "not_found" }, 404);
    const body = JSON.parse(raw) as { operationName: string; variables?: Vars };
    state.calls.push(body.operationName);
    const auth = new Headers(init.headers).get("authorization") ?? "";
    const me = state.tokens.get(auth.replace(/^Bearer /, ""));
    if (!me)
      return gqlError("Authentication required, not authenticated", "AUTHENTICATION_ERROR", 400);
    if (state.rateLimited)
      return json(
        { errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED" } }] },
        429,
        { "retry-after": "30" },
      );
    return graphql(body.operationName, body.variables ?? {}, me);
  }

  const f = (async (input: string | URL | Request, init: RequestInit = {}) =>
    handle(new URL(input instanceof Request ? input.url : input.toString()), init)) as typeof fetch;

  return {
    state,
    fetch: f,
    person(u: FakeLinearUser) {
      state.users.push(u);
      return u;
    },
    /** A team with Linear's default workflow and the labels given. */
    team(t: { id: string; key: string; name: string; labels?: string[] }): FakeLinearTeam {
      const states = [
        "Backlog:backlog",
        "Todo:unstarted",
        "In Progress:started",
        "Done:completed",
        "Canceled:canceled",
      ].map((s, i) => {
        const [name, type] = s.split(":") as [string, string];
        return { id: `${t.id}-st-${i}`, name, type, position: i };
      });
      const team: FakeLinearTeam = {
        id: t.id,
        key: t.key,
        name: t.name,
        states,
        labels: (t.labels ?? []).map((name) => ({ id: `${t.id}-lb-${name.toLowerCase()}`, name })),
      };
      state.teams.push(team);
      return team;
    },
    /** An existing issue; `state` is a state name in its team. */
    issue(i: {
      team: string;
      number: number;
      title: string;
      description?: string;
      state?: string;
      assignee?: string | null;
      priority?: number;
      labels?: string[];
    }): FakeLinearIssue {
      const t = state.teams.find((x) => x.key === i.team)!;
      const issue: FakeLinearIssue = {
        id: `issue-${++n}`,
        identifier: `${t.key}-${i.number}`,
        teamId: t.id,
        title: i.title,
        description: i.description ?? "",
        priority: i.priority ?? 0,
        stateId: t.states.find((s) => s.name === (i.state ?? "Todo"))!.id,
        assigneeId: i.assignee ?? null,
        labelIds: (i.labels ?? []).map((name) => t.labels.find((l) => l.name === name)!.id),
        comments: [],
        createdAt: now(),
        updatedAt: now(),
      };
      state.issues.push(issue);
      return issue;
    },
    /** Someone comments on an issue. */
    comment(identifier: string, userId: string, body: string) {
      findIssue(identifier)!.comments.push({ body, createdAt: now(), userId });
    },
    /** Signs a token in directly, as if a code exchange had happened. */
    grant(userId: string) {
      return issueToken(userId) as { access_token: string; refresh_token?: string };
    },
  };
}
