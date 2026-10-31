/**
 * An in-memory stand-in for the slice of GitHub the integration uses: the OAuth web flow
 * (with PKCE), app token revocation, and REST v3 issues, comments, pulls, reviews, checks,
 * contents and issue search. Pass `fake.fetch` as `GitHubAppConfig.fetch` in tests.
 */
export interface FakeRepo {
  /** "owner/name". */
  name: string;
  private?: boolean;
  /** Logins that can see a private repository. */
  members?: string[];
  /** Path → file contents. */
  files?: Record<string, string | Uint8Array>;
}

export interface FakeComment {
  id: number;
  author: string;
  body: string;
  created_at: string;
  /** The token that posted it, to tell posts as the user apart. */
  token?: string;
}

export interface FakeIssue {
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  state: "open" | "closed";
  state_reason?: string | null;
  labels: string[];
  assignees: string[];
  comments: FakeComment[];
  updated_at: string;
  /** Set for pull requests. */
  pr?: {
    head: string;
    base: string;
    sha: string;
    merged?: boolean;
    mergeable?: boolean | null;
    mergeable_state?: string;
    draft?: boolean;
    files: { filename: string; status: string; additions: number; deletions: number }[];
    reviews: { user: string; state: string }[];
    requested: string[];
    checks: { name: string; status: string; conclusion: string | null }[];
  };
}

/** A canned failure for the next API request matching `path` (a substring), once. */
export interface FakeFailure {
  path: string;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export function fakeGitHub(opts: { login?: string } = {}) {
  const state = {
    /** The login the next OAuth exchange signs in as. */
    nextLogin: opts.login ?? "ada",
    /** Scope the next OAuth exchange grants (GitHub's comma-separated form). */
    grantedScope: "read:org,repo",
    clientId: "gh-cid",
    clientSecret: "gh-secret",
    /** Access tokens, mapped to the login they act as. */
    tokens: new Map<string, string>(),
    /** "grant:<token>" or "token:<token>" for each revocation. */
    revoked: [] as string[],
    repos: [] as FakeRepo[],
    issues: [] as FakeIssue[],
    failures: [] as FakeFailure[],
    /** Requests seen, as "METHOD /path". */
    calls: [] as string[],
    /** What each token exchange sent, to check PKCE and the redirect URI. */
    exchanges: [] as { code_verifier: string | null; redirect_uri: string | null }[],
  };
  let n = 0;
  const now = () => new Date(Date.UTC(2026, 9, 1, 12, 0, ++n)).toISOString();

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  const notFound = () => json({ message: "Not Found" }, 404);

  const canSee = (login: string, repo: string) => {
    const r = state.repos.find((x) => x.name.toLowerCase() === repo.toLowerCase());
    return Boolean(r && (!r.private || r.members?.includes(login)));
  };
  const api = (path: string) => `https://api.github.com${path}`;
  const asIssue = (i: FakeIssue) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    state_reason: i.state_reason ?? null,
    user: { login: i.author },
    labels: i.labels.map((name) => ({ name })),
    assignees: i.assignees.map((login) => ({ login })),
    comments: i.comments.length,
    body: i.body,
    html_url: `https://github.com/${i.repo}/${i.pr ? "pull" : "issues"}/${i.number}`,
    repository_url: api(`/repos/${i.repo}`),
    created_at: "2026-09-01T00:00:00Z",
    updated_at: i.updated_at,
    ...(i.pr
      ? {
          draft: i.pr.draft ?? false,
          pull_request: { merged_at: i.pr.merged ? "2026-09-02T00:00:00Z" : null },
        }
      : {}),
  });

  /** Enough of GitHub's issue search: qualifiers used by the tools, plus plain words. */
  function searchIssues(login: string, q: string) {
    const terms = q.split(/\s+/).filter(Boolean);
    return state.issues.filter((i) => {
      if (!canSee(login, i.repo)) return false;
      return terms.every((t) => {
        const [k, v = ""] = t.includes(":") ? t.split(/:(.*)/) : ["", t];
        const who = v === "@me" ? login : v;
        switch (k) {
          case "repo":
            return i.repo.toLowerCase() === v.toLowerCase();
          case "org":
            return i.repo.toLowerCase().startsWith(`${v.toLowerCase()}/`);
          case "is":
            if (v === "open" || v === "closed") return i.state === v;
            if (v === "issue") return !i.pr;
            if (v === "pr") return Boolean(i.pr);
            if (v === "merged") return Boolean(i.pr?.merged);
            return true;
          case "author":
            return i.author === who;
          case "assignee":
            return i.assignees.includes(who);
          case "review-requested":
            return Boolean(i.pr?.requested.includes(who));
          case "label":
            return i.labels.includes(v);
          case "archived":
            return true;
          case "":
            return `${i.title} ${i.body}`.toLowerCase().includes(v.toLowerCase());
          default:
            return true;
        }
      });
    });
  }

  async function handle(url: URL, init: RequestInit): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const raw = typeof init.body === "string" ? init.body : (init.body?.toString() ?? "");
    const headers = new Headers(init.headers);

    if (url.host === "github.com" && url.pathname === "/login/oauth/access_token") {
      const p = new URLSearchParams(raw);
      state.exchanges.push({
        code_verifier: p.get("code_verifier"),
        redirect_uri: p.get("redirect_uri"),
      });
      if (p.get("client_secret") !== state.clientSecret || !p.get("code"))
        return json({ error: "bad_verification_code", error_description: "The code is wrong." });
      const token = `gho_${++n}`;
      state.tokens.set(token, state.nextLogin);
      return json({ access_token: token, scope: state.grantedScope, token_type: "bearer" });
    }
    if (url.host !== "api.github.com") return notFound();
    const path = url.pathname;
    state.calls.push(`${method} ${path}`);

    const appRevoke = /^\/applications\/([^/]+)\/(grant|token)$/.exec(path);
    if (appRevoke && method === "DELETE") {
      const basic = Buffer.from(`${state.clientId}:${state.clientSecret}`).toString("base64");
      if (headers.get("authorization") !== `Basic ${basic}`)
        return json({ message: "Requires authentication" }, 401);
      const { access_token } = JSON.parse(raw || "{}") as { access_token?: string };
      if (!access_token || !state.tokens.has(access_token))
        return json({ message: "Validation Failed" }, 422);
      state.tokens.delete(access_token);
      state.revoked.push(`${appRevoke[2]}:${access_token}`);
      return json(null, 204);
    }

    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const login = state.tokens.get(token);
    if (!login) return json({ message: "Bad credentials" }, 401);
    const failure = state.failures.findIndex((f) => path.includes(f.path));
    if (failure >= 0) {
      const [f] = state.failures.splice(failure, 1);
      return json(f!.body ?? { message: "Failure" }, f!.status, f!.headers);
    }
    if (headers.get("x-github-api-version") !== "2022-11-28")
      return json({ message: "Missing API version" }, 400);
    const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;

    if (path === "/user") return json({ login });
    if (path === "/search/issues") {
      const q = url.searchParams.get("q") ?? "";
      if (!/(^|\s)is:(issue|pr)\b/.test(q))
        return json({ message: "Query must include 'is:issue' or 'is:pull-request'" }, 422);
      const hits = searchIssues(login, q);
      const per = Number(url.searchParams.get("per_page") ?? 30);
      return json({ total_count: hits.length, items: hits.slice(0, per).map(asIssue) });
    }

    const m = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(path);
    if (!m) return notFound();
    const repo = decodeURIComponent(m[1]!);
    const rest = m[2] ?? "";
    if (!canSee(login, repo)) return notFound();
    const issueOf = (num: string) =>
      state.issues.find((i) => i.repo === repo && i.number === Number(num));

    if (rest === "/issues" && method === "POST") {
      const issue: FakeIssue = {
        repo,
        number:
          Math.max(0, ...state.issues.filter((i) => i.repo === repo).map((i) => i.number)) + 1,
        title: String(body.title),
        body: String(body.body ?? ""),
        author: login,
        state: "open",
        labels: (body.labels as string[]) ?? [],
        assignees: (body.assignees as string[]) ?? [],
        comments: [],
        updated_at: now(),
      };
      state.issues.push(issue);
      return json(asIssue(issue), 201);
    }
    const one = /^\/issues\/(\d+)$/.exec(rest);
    if (one) {
      const issue = issueOf(one[1]!);
      if (!issue) return notFound();
      if (method === "PATCH") {
        if (body.state) issue.state = body.state as "open" | "closed";
        if (body.state_reason) issue.state_reason = String(body.state_reason);
        if (typeof body.title === "string") issue.title = body.title;
        if (Array.isArray(body.labels)) issue.labels = body.labels as string[];
        if (Array.isArray(body.assignees)) issue.assignees = body.assignees as string[];
        issue.updated_at = now();
      }
      return json(asIssue(issue));
    }
    const comments = /^\/issues\/(\d+)\/comments$/.exec(rest);
    if (comments) {
      const issue = issueOf(comments[1]!);
      if (!issue) return notFound();
      if (method === "POST") {
        const c: FakeComment = {
          id: ++n,
          author: login,
          body: String(body.body ?? ""),
          created_at: now(),
          token,
        };
        issue.comments.push(c);
        return json({ id: c.id, html_url: `${asIssue(issue).html_url}#issuecomment-${c.id}` }, 201);
      }
      const per = Number(url.searchParams.get("per_page") ?? 30);
      const page = Number(url.searchParams.get("page") ?? 1);
      return json(
        issue.comments.slice((page - 1) * per, page * per).map((c) => ({
          user: { login: c.author },
          body: c.body,
          created_at: c.created_at,
        })),
      );
    }
    const pull = /^\/pulls\/(\d+)(\/files|\/reviews)?$/.exec(rest);
    if (pull) {
      const issue = issueOf(pull[1]!);
      if (!issue?.pr) return notFound();
      const pr = issue.pr;
      if (pull[2] === "/files") return json(pr.files);
      if (pull[2] === "/reviews")
        return json(pr.reviews.map((v) => ({ user: { login: v.user }, state: v.state })));
      return json({
        head: { ref: pr.head, sha: pr.sha, label: `${repo.split("/")[0]}:${pr.head}` },
        base: { ref: pr.base },
        merged: pr.merged ?? false,
        mergeable: pr.mergeable ?? true,
        mergeable_state: pr.mergeable_state ?? "clean",
        draft: pr.draft ?? false,
        additions: pr.files.reduce((s, f) => s + f.additions, 0),
        deletions: pr.files.reduce((s, f) => s + f.deletions, 0),
        changed_files: pr.files.length,
        commits: 1,
        requested_reviewers: pr.requested.map((l) => ({ login: l })),
        requested_teams: [],
      });
    }
    const commit = /^\/commits\/([^/]+)\/(check-runs|status)$/.exec(rest);
    if (commit) {
      const pr = state.issues.find((i) => i.repo === repo && i.pr?.sha === commit[1])?.pr;
      if (commit[2] === "status") return json({ state: "success", statuses: [] });
      return json({ total_count: pr?.checks.length ?? 0, check_runs: pr?.checks ?? [] });
    }
    const contents = /^\/contents\/(.+)$/.exec(rest);
    if (contents) {
      const files = state.repos.find((x) => x.name === repo)?.files ?? {};
      const p = decodeURIComponent(contents[1]!);
      const file = files[p];
      if (file === undefined) {
        const inside = Object.keys(files).filter((f) => f.startsWith(`${p}/`));
        if (!inside.length) return notFound();
        const names = [...new Set(inside.map((f) => f.slice(p.length + 1).split("/")[0]!))];
        return json(
          names.map((name) => ({
            name,
            path: `${p}/${name}`,
            type: files[`${p}/${name}`] === undefined ? "dir" : "file",
            size: 0,
          })),
        );
      }
      const bytes = typeof file === "string" ? new TextEncoder().encode(file) : file;
      return json({
        type: "file",
        path: p,
        size: bytes.length,
        encoding: "base64",
        content: Buffer.from(bytes).toString("base64"),
      });
    }
    return notFound();
  }

  const f = (async (input: string | URL | Request, init: RequestInit = {}) =>
    handle(new URL(input instanceof Request ? input.url : input.toString()), init)) as typeof fetch;

  return {
    state,
    fetch: f,
    /** Adds a repository. */
    repo(r: FakeRepo) {
      state.repos.push(r);
      return r;
    },
    /** Adds an issue, or a pull request when `pr` is set. */
    issue(i: Partial<FakeIssue> & Pick<FakeIssue, "repo" | "number" | "title">): FakeIssue {
      const issue: FakeIssue = {
        body: "",
        author: "someone",
        state: "open",
        labels: [],
        assignees: [],
        comments: [],
        updated_at: now(),
        ...i,
      };
      state.issues.push(issue);
      return issue;
    },
    /** Someone comments on an issue or pull request. */
    comment(issue: FakeIssue, author: string, body: string) {
      issue.comments.push({ id: ++n, author, body, created_at: now() });
    },
    /** Fails the next request whose path contains `path`. */
    failNext(failure: FakeFailure) {
      state.failures.push(failure);
    },
  };
}
