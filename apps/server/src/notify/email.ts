import { schema } from "@synapse/db";
import { and, eq, inArray } from "drizzle-orm";
import nodemailer from "nodemailer";
import { log } from "../log";
import type { Services } from "../services";
import type { NotificationChannel, PendingApproval } from "./types";

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Anything that can send a message: nodemailer's SMTP transport, or a fake in tests. */
export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

export function smtpTransport(smtpUrl: string): MailTransport {
  return nodemailer.createTransport(smtpUrl);
}

/**
 * Email alerts, for people who turned them on in Settings. One email per recipient per
 * batch, to their account address. Deliberately no approve/deny links: mail scanners open
 * every link in a message, so the only link is to the task, where a person decides.
 */
export class EmailChannel implements NotificationChannel {
  readonly name = "email";

  constructor(
    private readonly services: () => Services,
    private readonly from: string,
    private readonly transport: MailTransport,
  ) {}

  async notify(approvals: PendingApproval[]): Promise<void> {
    const recipients = [...new Set(approvals.flatMap((a) => a.recipients))];
    if (recipients.length === 0) return;
    const people = await this.services()
      .database.db.select({ id: schema.user.id, email: schema.user.email, name: schema.user.name })
      .from(schema.user)
      .innerJoin(schema.userSettings, eq(schema.userSettings.userId, schema.user.id))
      .where(and(inArray(schema.user.id, recipients), eq(schema.userSettings.emailAlerts, true)));
    await Promise.all(
      people.map(async (person) => {
        const items = approvals.filter((a) => a.recipients.includes(person.id));
        try {
          await this.transport.sendMail({ from: this.from, to: person.email, ...render(items) });
        } catch (error) {
          log.warn("alert email failed", { userId: person.id, error: String(error) });
        }
      }),
    );
  }
}

export function render(items: PendingApproval[]): Pick<MailMessage, "subject" | "text" | "html"> {
  const first = items[0]!;
  const subject =
    items.length === 1
      ? `Synapse needs your OK: ${oneLine(first.preview ?? first.name, 80)}`
      : `Synapse needs your OK on ${items.length} actions`;
  const intro =
    items.length === 1
      ? "A task is waiting for you before it acts."
      : `${items.length} actions are waiting for you before they run.`;
  const footer =
    "Open the task to approve, edit or deny. For your safety this email has no approve " +
    "buttons: mail scanners open links, and an approval should always be yours.";

  const text = [
    intro,
    "",
    ...items.flatMap((a) => [
      `• ${a.preview ?? a.name}`,
      `  Action: ${a.name} (${a.effect})`,
      ...(a.chatTitle ? [`  Task: ${a.chatTitle}`] : []),
      `  Why it's asking: ${why(a)}`,
      `  Open: ${a.url}`,
      "",
    ]),
    footer,
  ].join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f1ea;color:#15140f;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e2dccf;border-radius:12px;padding:24px">
<p style="margin:0 0 16px">${esc(intro)}</p>
${items
  .map(
    (a) => `<div style="border-top:1px solid #e2dccf;padding:16px 0">
<p style="margin:0 0 6px;font-weight:600">${esc(a.preview ?? a.name)}</p>
<p style="margin:0;color:#5f5a4f;font-size:13px">${esc(a.name)} · ${esc(a.effect)}${a.chatTitle ? ` · ${esc(a.chatTitle)}` : ""}</p>
<p style="margin:6px 0 10px;color:#5f5a4f;font-size:13px">Why it's asking: ${esc(why(a))}</p>
<a href="${esc(a.url)}" style="color:#3b48cc">Open the task</a>
</div>`,
  )
  .join("\n")}
<p style="margin:16px 0 0;color:#948d7e;font-size:12px">${esc(footer)}</p>
</div></body></html>`;
  return { subject, text, html };
}

function why(a: PendingApproval) {
  const reason = a.reason ?? `${a.effect} actions ask first`;
  return a.tainted
    ? `${reason}. The task had read outside content (an email or web page) by then.`
    : reason;
}

function oneLine(s: string, max: number) {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function esc(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
