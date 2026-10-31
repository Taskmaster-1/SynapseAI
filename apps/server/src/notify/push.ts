import type { Effect } from "@synapse/core";
import { DEFAULT_UNDO_SECONDS, schema } from "@synapse/db";
import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import type { PushConfig } from "../config";
import { log } from "../log";
import type { Services } from "../services";
import { detailLines, TITLE } from "./text";
import type { NotificationChannel, PendingApproval, UserNotice } from "./types";

/** What the service worker receives (public/sw.js reads exactly these fields). */
export interface PushMessage {
  title: string;
  body: string;
  /** Replaces an earlier notification with the same tag on the device. */
  tag: string;
  data: {
    url: string;
    runId?: string;
    toolCallId?: string;
    effect?: Effect;
  };
  /** Shown as buttons where the platform supports them (not on iOS). */
  actions?: { action: "approve" | "deny"; title: string }[];
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Delivers one encrypted message to one device; resolves with the push service's status. */
export type PushSender = (
  target: PushTarget,
  payload: string,
  options: { vapid: PushConfig; ttlSeconds: number; urgency: "normal" | "high" },
) => Promise<{ statusCode: number }>;

/** The real sender: standards Web Push with VAPID through the `web-push` package. */
export const webPushSender: PushSender = async (
  target,
  payload,
  { vapid, ttlSeconds, urgency },
) => {
  try {
    const res = await webpush.sendNotification(target, payload, {
      vapidDetails: {
        subject: vapid.subject,
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
      TTL: ttlSeconds,
      urgency,
      timeout: 10_000,
    });
    return { statusCode: res.statusCode };
  } catch (error) {
    if (error instanceof webpush.WebPushError) return { statusCode: error.statusCode };
    throw error;
  }
};

/**
 * Only real push services: the server POSTs to whatever endpoint a browser hands over, so
 * anything else (an internal address) is refused. Covers Chrome/Edge/Android (FCM),
 * Firefox (Mozilla), Safari and iOS (Apple) and Windows (WNS).
 */
const PUSH_HOSTS = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  ".push.services.mozilla.com",
  "web.push.apple.com",
  ".push.apple.com",
  ".notify.windows.com",
];

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "") return false;
  return PUSH_HOSTS.some((h) =>
    h.startsWith(".") ? url.hostname.endsWith(h) : url.hostname === h,
  );
}

const PREVIEW_MAX = 180;
/** An approval nobody acts on for a day is stale on the lock screen. */
const TTL_SECONDS = 24 * 3600;

/**
 * Web Push: one notification per approval, or one summary when several arrive at once for
 * one person. Delivered to every device each recipient subscribed; devices the push
 * service no longer knows (404/410) are forgotten.
 */
export class PushChannel implements NotificationChannel {
  readonly name = "push";

  constructor(
    private readonly services: () => Services,
    readonly config: PushConfig,
    private readonly send: PushSender = webPushSender,
  ) {}

  async notify(approvals: PendingApproval[]): Promise<void> {
    const open = await this.stillWaiting(approvals);
    if (open.length === 0) return;
    const byRecipient = new Map<string, PendingApproval[]>();
    for (const a of open)
      for (const r of new Set(a.recipients)) byRecipient.set(r, [...(byRecipient.get(r) ?? []), a]);
    const undo = await this.undoSeconds(open.map((a) => a.userId));
    await Promise.all(
      [...byRecipient].map(([recipient, items]) =>
        this.sendToUser(recipient, this.message(items, undo)),
      ),
    );
  }

  async notice(notices: UserNotice[]): Promise<void> {
    await Promise.all(
      notices.map((n) =>
        this.sendToUser(n.userId, {
          title: n.title,
          body: clip(n.body, 300),
          tag: n.tag,
          data: { url: n.url },
        }),
      ),
    );
  }

  /** Sends one message to all of a user's devices. */
  async sendToUser(
    userId: string,
    message: PushMessage,
  ): Promise<{ sent: number; removed: number }> {
    const { database, box } = this.services();
    const subs = await database.db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, userId));
    const payload = JSON.stringify(message);
    let sent = 0;
    let removed = 0;
    await Promise.all(
      subs.map(async (sub) => {
        try {
          const target = {
            endpoint: sub.endpoint,
            keys: { p256dh: await box.open(sub.p256dh), auth: await box.open(sub.auth) },
          };
          const { statusCode } = await this.send(target, payload, {
            vapid: this.config,
            ttlSeconds: TTL_SECONDS,
            urgency: "high",
          });
          if (statusCode === 404 || statusCode === 410) {
            await database.db
              .delete(schema.pushSubscriptions)
              .where(eq(schema.pushSubscriptions.id, sub.id));
            removed++;
          } else if (statusCode >= 200 && statusCode < 300) {
            await database.db
              .update(schema.pushSubscriptions)
              .set({ lastUsedAt: new Date() })
              .where(eq(schema.pushSubscriptions.id, sub.id));
            sent++;
          } else {
            log.warn("push rejected", { subscription: sub.id, statusCode });
          }
        } catch (error) {
          log.warn("push failed", { subscription: sub.id, error: String(error) });
        }
      }),
    );
    return { sent, removed };
  }

  private message(items: PendingApproval[], undo: Map<string, number>): PushMessage {
    const { config } = this.services();
    const first = items[0]!;
    if (items.length === 1) {
      // A send or delete approved from the lock screen still waits out the undo window;
      // with no window, it has to be opened and approved in the app.
      const risky = first.effect === "send" || first.effect === "destructive";
      const approvable = !risky || (undo.get(first.userId) ?? DEFAULT_UNDO_SECONDS) > 0;
      return {
        title: TITLE[first.kind],
        body: clip([first.preview ?? describe(first), ...detailLines(first)].join("\n"), 300),
        tag: first.toolCallId,
        data: {
          url: first.url,
          runId: first.runId,
          toolCallId: first.toolCallId,
          effect: first.effect,
        },
        actions: approvable
          ? [
              { action: "approve", title: "Approve" },
              { action: "deny", title: "Deny" },
            ]
          : [{ action: "deny", title: "Deny" }],
      };
    }
    const sameTask = items.every((a) => a.chatId === first.chatId);
    return {
      title:
        first.kind === "new"
          ? `Synapse needs your OK on ${items.length} actions`
          : `${TITLE[first.kind]} (${items.length} actions)`,
      body: clip(items.map((a) => `• ${a.preview ?? describe(a)}`).join("\n"), 300),
      tag: sameTask ? `run:${first.runId}` : "approvals",
      data: { url: sameTask ? first.url : `${config.PUBLIC_URL}/approvals` },
    };
  }

  /** Never announce something already decided (e.g. approved on another device). */
  private async stillWaiting(approvals: PendingApproval[]) {
    if (approvals.length === 0) return [];
    const rows = await this.services()
      .database.db.select({ runId: schema.toolCalls.runId, id: schema.toolCalls.id })
      .from(schema.toolCalls)
      .where(
        and(
          inArray(schema.toolCalls.runId, [...new Set(approvals.map((a) => a.runId))]),
          eq(schema.toolCalls.status, "awaiting_approval"),
        ),
      );
    const open = new Set(rows.map((r) => `${r.runId}/${r.id}`));
    return approvals.filter((a) => open.has(`${a.runId}/${a.toolCallId}`));
  }

  private async undoSeconds(userIds: string[]) {
    const rows = await this.services()
      .database.db.select({
        userId: schema.userSettings.userId,
        undoSeconds: schema.userSettings.undoSeconds,
      })
      .from(schema.userSettings)
      .where(inArray(schema.userSettings.userId, [...new Set(userIds)]));
    return new Map(rows.map((r) => [r.userId, r.undoSeconds]));
  }
}

function describe(a: PendingApproval) {
  return a.chatTitle ? `${a.name} in “${a.chatTitle}”` : a.name;
}

function clip(text: string, max = PREVIEW_MAX) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "Safari on iPhone" from a User-Agent header, for the device list. */
export function deviceLabel(userAgent: string | undefined | null): string | null {
  if (!userAgent) return null;
  const os = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Mac OS X/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\/|FxiOS/.test(userAgent)
      ? "Firefox"
      : /Chrome\/|CriOS/.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? userAgent.slice(0, 60);
}
