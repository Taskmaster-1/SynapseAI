import type { Effect } from "@synapse/core";
import { ConflictError, NotFoundError, schema } from "@synapse/db";
import type { JSONValue } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { DecisionInputError, decide } from "../decisions";
import { log } from "../log";
import type { Services } from "../services";
import { SlackApiError, type SlackAppConfig, slackCall, slackRespond } from "./slack-api";
import type {
  DecisionSource,
  NotificationChannel,
  PendingApproval,
  ResolvedApproval,
} from "./types";

/** Slack block, loosely typed: we only build a handful of kinds. */
type Block = Record<string, unknown>;

/** What a button carries back. Untrusted: checked against the clicking user's own DMs. */
interface ActionRef {
  r: string;
  t: string;
}

/** The parts of a Slack `block_actions` payload we read. */
export interface SlackInteraction {
  type: string;
  team?: { id?: string } | null;
  user?: { id?: string; team_id?: string };
  response_url?: string;
  actions?: { action_id?: string; value?: string }[];
}

/** Slack errors that mean the stored token no longer works. */
const DEAD_TOKEN = new Set(["invalid_auth", "account_inactive", "token_revoked", "not_authed"]);

/**
 * Approvals as Slack DMs, with Approve / Deny buttons. Each recipient who connected Slack
 * gets a message; it is rewritten once the action is decided anywhere.
 */
export class SlackChannel implements NotificationChannel {
  readonly name = "slack";
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(private readonly services: () => Services) {}

  private get app(): SlackAppConfig | null {
    return this.services().config.slack;
  }

  /** Runs work after the HTTP response (Slack wants an answer within 3 seconds). */
  later(work: () => Promise<void>) {
    const p = work()
      .catch((error) => log.warn("slack: background work failed", { error: String(error) }))
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Resolves when background work has finished. For tests and shutdown. */
  async settled() {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }

  async notify(approvals: PendingApproval[]) {
    const app = this.app;
    if (!app || approvals.length === 0) return;
    const { db } = this.services().database;
    const recipients = [...new Set(approvals.flatMap((a) => a.recipients))];
    const accounts = await db
      .select()
      .from(schema.slackAccounts)
      .where(
        and(
          inArray(schema.slackAccounts.userId, recipients),
          eq(schema.slackAccounts.status, "active"),
        ),
      );
    for (const account of accounts) {
      const mine = approvals.filter((a) => a.recipients.includes(account.userId));
      try {
        const token = await this.services().box.open(account.botToken);
        const channel = await openDm(app, token, account.slackUserId);
        for (const a of mine) {
          const posted = await slackCall<{ channel: string; ts: string }>(
            app,
            token,
            "chat.postMessage",
            {
              channel,
              text: `Synapse needs your OK: ${a.preview ?? humanize(a.name)}`,
              blocks: approvalBlocks(a),
              unfurl_links: false,
              unfurl_media: false,
            },
          );
          await db
            .insert(schema.slackMessages)
            .values({
              runId: a.runId,
              toolCallId: a.toolCallId,
              userId: account.userId,
              channel: posted.channel,
              ts: posted.ts,
            })
            .onConflictDoNothing();
        }
      } catch (error) {
        await this.failed(account.userId, error);
      }
    }
  }

  async resolved(decided: ResolvedApproval[]) {
    for (const d of decided)
      await this.rewrite(d.runId, d.toolCallId, (recipient) =>
        outcomeText({
          approved: d.approved,
          via: d.via,
          byYou: d.via === "slack" && recipient === d.userId,
          executeAfter: d.executeAfter,
        }),
      );
  }

  /** Rewrites a call's messages to show where it stands now (after "already decided"). */
  async refresh(runId: string, toolCallId: string) {
    const call = await loadCall(this.services(), runId, toolCallId);
    if (!call || call.status === "awaiting_approval") return;
    const approved = call.status !== "denied";
    await this.rewrite(runId, toolCallId, (recipient) =>
      outcomeText({
        approved,
        via: (call.decidedVia ?? "web") as DecisionSource,
        byYou: call.decidedVia === "slack" && call.decidedBy === recipient,
        executeAfter: call.status === "approved" ? call.executeAfter : null,
        done:
          call.status === "succeeded"
            ? "done"
            : call.status === "failed" || call.status === "unknown"
              ? "failed"
              : null,
      }),
    );
  }

  private async rewrite(runId: string, toolCallId: string, text: (recipient: string) => string) {
    const app = this.app;
    if (!app) return;
    const { db } = this.services().database;
    const sent = await db
      .select({
        userId: schema.slackMessages.userId,
        channel: schema.slackMessages.channel,
        ts: schema.slackMessages.ts,
        botToken: schema.slackAccounts.botToken,
      })
      .from(schema.slackMessages)
      .innerJoin(schema.slackAccounts, eq(schema.slackAccounts.userId, schema.slackMessages.userId))
      .where(
        and(eq(schema.slackMessages.runId, runId), eq(schema.slackMessages.toolCallId, toolCallId)),
      );
    if (sent.length === 0) return;
    const call = await loadCall(this.services(), runId, toolCallId);
    if (!call) return;
    for (const m of sent) {
      const line = text(m.userId);
      try {
        await slackCall(app, await this.services().box.open(m.botToken), "chat.update", {
          channel: m.channel,
          ts: m.ts,
          text: `${line}: ${call.preview ?? humanize(call.name)}`,
          blocks: decidedBlocks(call, line),
        });
      } catch (error) {
        await this.failed(m.userId, error);
      }
    }
  }

  /**
   * A verified button click. Acts only for the Synapse user who connected this Slack
   * identity, and only on an action that was sent to them.
   */
  async handleInteraction(payload: SlackInteraction) {
    const app = this.app;
    if (!app || payload.type !== "block_actions") return;
    const action = payload.actions?.[0];
    if (action?.action_id !== "approve" && action?.action_id !== "deny") return;
    const ref = parseRef(action.value);
    const teamId = payload.team?.id ?? payload.user?.team_id;
    const slackUserId = payload.user?.id;
    const refuse = (text: string) =>
      payload.response_url
        ? slackRespond(app, payload.response_url, {
            response_type: "ephemeral",
            replace_original: false,
            text,
          })
        : Promise.resolve();
    if (!ref || !teamId || !slackUserId) return;

    const { db } = this.services().database;
    const [account] = await db
      .select({ userId: schema.slackAccounts.userId })
      .from(schema.slackAccounts)
      .where(
        and(
          eq(schema.slackAccounts.teamId, teamId),
          eq(schema.slackAccounts.slackUserId, slackUserId),
          eq(schema.slackAccounts.status, "active"),
        ),
      );
    if (!account) return refuse("Your Slack account isn't connected to Synapse.");
    const [sent] = await db
      .select({ runId: schema.slackMessages.runId })
      .from(schema.slackMessages)
      .where(
        and(
          eq(schema.slackMessages.runId, ref.r),
          eq(schema.slackMessages.toolCallId, ref.t),
          eq(schema.slackMessages.userId, account.userId),
        ),
      );
    if (!sent) return refuse("Only the person this was sent to can decide it.");

    try {
      await decide(this.services(), {
        userId: account.userId,
        runId: ref.r,
        decisions: [{ toolCallId: ref.t, approved: action.action_id === "approve" }],
        via: "slack",
      });
    } catch (error) {
      if (error instanceof ConflictError) return this.refresh(ref.r, ref.t);
      // e.g. sent to someone who may see it but not decide it here (not the task's owner).
      if (error instanceof NotFoundError)
        return refuse("This one can't be decided from Slack. Open it in Synapse.");
      if (error instanceof DecisionInputError) return refuse(error.message);
      throw error;
    }
  }

  /** Sends a hello DM so people can see where approvals will land. */
  async sendTest(userId: string): Promise<boolean> {
    const app = this.app;
    if (!app) return false;
    const [account] = await this.services()
      .database.db.select()
      .from(schema.slackAccounts)
      .where(eq(schema.slackAccounts.userId, userId));
    if (!account) return false;
    try {
      const token = await this.services().box.open(account.botToken);
      const channel = await openDm(app, token, account.slackUserId);
      await slackCall(app, token, "chat.postMessage", {
        channel,
        text: "Synapse is connected. When a task needs your OK, it will ask here.",
        blocks: [
          section(
            "*Synapse is connected.* When a task needs your OK, it will ask here, with Approve and Deny buttons.",
          ),
          context(`<${this.services().config.PUBLIC_URL}/connections|Manage in Synapse>`),
        ],
      });
      if (account.status !== "active")
        await this.services()
          .database.db.update(schema.slackAccounts)
          .set({ status: "active", lastError: null })
          .where(eq(schema.slackAccounts.userId, userId));
      return true;
    } catch (error) {
      await this.failed(userId, error);
      throw error;
    }
  }

  private async failed(userId: string, error: unknown) {
    log.warn("slack: delivery failed", { userId, error: String(error) });
    if (error instanceof SlackApiError && DEAD_TOKEN.has(error.code))
      await this.services()
        .database.db.update(schema.slackAccounts)
        .set({ status: "error", lastError: "Slack access was revoked. Reconnect Slack." })
        .where(eq(schema.slackAccounts.userId, userId));
  }
}

async function openDm(app: SlackAppConfig, token: string, slackUserId: string) {
  const res = await slackCall<{ channel: { id: string } }>(app, token, "conversations.open", {
    users: slackUserId,
  });
  return res.channel.id;
}

interface CallInfo {
  name: string;
  effect: Effect;
  preview: string | null;
  title: string | null;
  url: string;
  status: string;
  decidedVia: string | null;
  decidedBy: string | null;
  executeAfter: Date | null;
}

async function loadCall(
  services: Services,
  runId: string,
  toolCallId: string,
): Promise<CallInfo | null> {
  const [row] = await services.database.db
    .select({
      name: schema.toolCalls.name,
      effect: schema.toolCalls.effect,
      preview: schema.toolCalls.preview,
      title: schema.chats.title,
      chatId: schema.chats.id,
      status: schema.toolCalls.status,
      decidedVia: schema.toolCalls.decidedVia,
      decidedBy: schema.toolCalls.decidedBy,
      executeAfter: schema.toolCalls.executeAfter,
    })
    .from(schema.toolCalls)
    .innerJoin(schema.runs, eq(schema.runs.id, schema.toolCalls.runId))
    .innerJoin(schema.chats, eq(schema.chats.id, schema.runs.chatId))
    .where(and(eq(schema.toolCalls.runId, runId), eq(schema.toolCalls.id, toolCallId)));
  if (!row) return null;
  return { ...row, url: `${services.config.PUBLIC_URL}/t/${row.chatId}` };
}

function parseRef(value: string | undefined): ActionRef | null {
  try {
    const v = JSON.parse(value ?? "") as Partial<ActionRef>;
    return typeof v.r === "string" && typeof v.t === "string" && v.r && v.t
      ? { r: v.r, t: v.t }
      : null;
  } catch {
    return null;
  }
}

// ── Rendering ──────────────────────────────────────────────────────────────

const PLACE: Record<DecisionSource, string> = {
  web: "in the web app",
  push: "from your phone",
  slack: "in Slack",
  email: "by email",
};

/** The status line that replaces the buttons, e.g. "Approved by you · sending in 10s". */
export function outcomeText(o: {
  approved: boolean;
  via: DecisionSource;
  byYou: boolean;
  executeAfter: Date | null;
  done?: "done" | "failed" | null;
  now?: number;
}): string {
  const where = o.byYou ? "by you" : (PLACE[o.via] ?? "elsewhere");
  if (!o.approved) return `Denied ${where}`;
  let line = `Approved ${where}`;
  const wait = o.executeAfter
    ? Math.round((o.executeAfter.getTime() - (o.now ?? Date.now())) / 1000)
    : 0;
  if (wait > 0) line += ` · sending in ${wait}s (undo in Synapse)`;
  if (o.done === "done") line += " · done";
  if (o.done === "failed") line += " · it failed, see Synapse";
  return line;
}

/** Slack mrkdwn: these three must be escaped so text can't become links or mentions. */
export function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clip(s: string, n: number) {
  const flat = s.trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}

function humanize(name: string) {
  const s = name.replace(/[_-]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const section = (text: string): Block => ({
  type: "section",
  text: { type: "mrkdwn", text: clip(text, 2900) },
});
const context = (text: string): Block => ({
  type: "context",
  elements: [{ type: "mrkdwn", text: clip(text, 2900) }],
});

function str(v: JSONValue | undefined): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v.join(", ");
  return JSON.stringify(v);
}

/** A short rendering of the input: email-shaped inputs as an email, others as key fields. */
export function renderInput(input: JSONValue): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    const s = str(input);
    return s ? `\`${esc(clip(s, 300))}\`` : null;
  }
  const o = input as Record<string, JSONValue>;
  const lines: string[] = [];
  if ("to" in o || "subject" in o) {
    for (const key of ["to", "cc", "bcc", "subject"] as const) {
      const v = str(o[key]);
      if (v)
        lines.push(
          `*${key === "subject" ? "Subject" : key.charAt(0).toUpperCase() + key.slice(1)}:* ${esc(clip(v, 200))}`,
        );
    }
    const body = str(o.body ?? o.text ?? o.message);
    if (body) {
      const first = body
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .slice(0, 5);
      lines.push(...first.map((l) => `> ${esc(clip(l, 200))}`));
      if (body.split(/\r?\n/).filter((l) => l.trim()).length > first.length) lines.push("> …");
    }
    return lines.join("\n") || null;
  }
  const entries = Object.entries(o).filter(([, v]) => v !== null && v !== undefined);
  for (const [k, v] of entries.slice(0, 6))
    lines.push(`*${esc(humanize(k))}:* ${esc(clip(str(v) ?? "", 160))}`);
  if (entries.length > 6) lines.push(`_…and ${entries.length - 6} more_`);
  return lines.join("\n") || null;
}

/** The DM asking for an OK. */
export function approvalBlocks(a: PendingApproval): Block[] {
  const value = JSON.stringify({ r: a.runId, t: a.toolCallId } satisfies ActionRef);
  const input = renderInput(a.input);
  return [
    { type: "header", text: { type: "plain_text", text: "Synapse needs your OK" } },
    section(`*${esc(a.preview ?? humanize(a.name))}*`),
    context(
      `Task: ${esc(clip(a.chatTitle ?? "Untitled task", 150))} · \`${esc(a.name)}\` (${a.effect})`,
    ),
    ...(input ? [section(input)] : []),
    ...(a.reason ? [context(`Why it asks: ${esc(clip(a.reason, 300))}`)] : []),
    ...(a.tainted
      ? [
          section(
            "*Careful:* this task read outside content (an email or a web page) before proposing this. Check it is what you want.",
          ),
        ]
      : []),
    {
      type: "actions",
      block_id: "decision",
      elements: [
        {
          type: "button",
          action_id: "approve",
          style: "primary",
          text: { type: "plain_text", text: "Approve" },
          value,
        },
        {
          type: "button",
          action_id: "deny",
          style: "danger",
          text: { type: "plain_text", text: "Deny" },
          value,
        },
        {
          type: "button",
          action_id: "open",
          text: { type: "plain_text", text: "Open in Synapse" },
          url: a.url,
        },
      ],
    },
  ];
}

/** The same message once decided: no buttons, a status line instead. */
export function decidedBlocks(call: CallInfo, line: string): Block[] {
  return [
    section(`*${esc(call.preview ?? humanize(call.name))}*`),
    context(
      `Task: ${esc(clip(call.title ?? "Untitled task", 150))} · <${call.url}|Open in Synapse>`,
    ),
    section(`*${esc(line)}*`),
  ];
}
