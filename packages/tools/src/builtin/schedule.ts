import type { ToolDefinition } from "@synapse/core";
import { type Db, isTimeZone, planSchedule, REPEATS, schema } from "@synapse/db";
import type { JSONValue } from "ai";
import { and, asc, eq, sql } from "drizzle-orm";

/** Active scheduled automations one person may have, so a loop cannot pile them up. */
export const MAX_SCHEDULED = 100;
const MAX_TITLE = 80;
const MAX_INSTRUCTIONS = 4000;

interface ScheduleInput {
  title: string;
  instructions: string;
  when: string;
  kind: "reminder" | "task";
  repeat?: string;
  timezone?: string;
}

/**
 * Formats a time for people, in a time zone: "Fri 7 Nov, 09:00" (the year only when it is
 * not this year). Without a zone, uses the offset written in `iso`, which is the zone the
 * model resolved the time in.
 */
export function formatWhen(at: Date, timezone: string | null, iso?: string): string {
  let zone = timezone && isTimeZone(timezone) ? timezone : "UTC";
  let shown = at;
  if (!timezone && iso) {
    // A bare offset is no IANA zone: shift the instant and print it as UTC.
    const m = /([+-])(\d{2}):(\d{2})$/.exec(iso.trim());
    if (m) {
      const minutes = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
      shown = new Date(at.getTime() + minutes * 60_000);
      zone = "UTC";
    }
  }
  const sameYear =
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric" }).format(shown) ===
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric" }).format(new Date());
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  })
    .format(shown)
    .replace(",", "");
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(shown);
  return `${day}, ${time}`;
}

/** "weekly", "weekdays", or the cron itself; null for a one-off. */
function repeatLabel(repeat: string | undefined): string | null {
  const r = repeat?.trim();
  if (!r || r === "none") return null;
  return r;
}

/** One line for approval cards and the activity log. */
export function schedulePreview(input: JSONValue, timezone: string | null): string {
  const i = input as Partial<ScheduleInput>;
  const at = new Date(String(i.when ?? ""));
  const when = Number.isNaN(at.getTime())
    ? String(i.when ?? "an invalid time")
    : formatWhen(at, i.timezone && isTimeZone(i.timezone) ? i.timezone : timezone, i.when);
  const every = repeatLabel(i.repeat);
  const head = i.kind === "reminder" ? "Remind you" : "Schedule for";
  return `${head} ${when}${every ? ` (${every})` : ""}: ${i.title ?? i.instructions ?? ""}`;
}

/**
 * Scheduling future work for the user: reminders ("remind me Friday at 9 to send the
 * report") and follow-ups the agent does itself ("in 3 days, check whether Sam replied").
 * Each is a one-off or recurring automation on the chat it was asked in, so when it fires
 * the agent continues that conversation with its context; a reminder only notifies.
 *
 * Scheduling and cancelling run without approval by default: they touch only the user's
 * own account, and a fired task is a fresh run whose every action goes through policy again.
 * Like every non-read tool they ask once the run has read outside content, so an email
 * cannot plant a scheduled instruction without the user seeing it.
 */
export function scheduleTools(db: Db, timezone: string | null): ToolDefinition[] {
  const zoneNote = timezone
    ? `The user's time zone is ${timezone}.`
    : "The user has not set a time zone; ask for it if the time of day matters and you cannot tell.";
  return [
    {
      name: "schedule_task",
      description: `Schedule something for later in this conversation. kind "reminder": at that time the user is just notified (push, Slack, email, as they set up) with the title and instructions; no action is taken. kind "task": at that time you continue this conversation and carry out the instructions (e.g. "check whether Sam replied to my email about the report; if not, draft a short nudge"). Write instructions as a complete task prompt that makes sense on its own. Resolve relative times ("Friday at 9", "in 3 days") yourself into an ISO 8601 time with the user's UTC offset; call list_scheduled first if you need the current time. ${zoneNote}`,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: MAX_TITLE, description: "Short label." },
          instructions: {
            type: "string",
            maxLength: MAX_INSTRUCTIONS,
            description:
              "For a reminder, what to tell the user. For a task, what you should do then.",
          },
          when: {
            type: "string",
            description:
              "First (or only) time, ISO 8601 with offset, e.g. 2026-11-07T09:00:00+01:00. In the future, within a year.",
          },
          kind: { type: "string", enum: ["reminder", "task"] },
          repeat: {
            type: "string",
            description: `One of ${REPEATS.join(", ")} (anchored on the day and time of \`when\`), or a five-field cron expression. Default none.`,
          },
          timezone: {
            type: "string",
            description: "IANA time zone, only if the user named one other than their own.",
          },
        },
        required: ["title", "instructions", "when", "kind"],
        additionalProperties: false,
      },
      effect: "write",
      defaultDecision: "allow",
      untrustedOutput: false,
      source: "builtin",
      preview: (input) => schedulePreview(input, timezone),
      execute: async (input, ctx) => {
        const i = input as Partial<ScheduleInput>;
        const title = String(i.title ?? "")
          .trim()
          .slice(0, MAX_TITLE);
        const instructions = String(i.instructions ?? "")
          .trim()
          .slice(0, MAX_INSTRUCTIONS);
        if (!title || !instructions)
          return { type: "error", value: "title and instructions are required." };
        if (i.kind !== "reminder" && i.kind !== "task")
          return { type: "error", value: 'kind must be "reminder" or "task".' };
        const zone = i.timezone?.trim() || timezone || "UTC";
        const plan = planSchedule({ when: String(i.when ?? ""), repeat: i.repeat, timezone: zone });
        if (typeof plan === "string") return { type: "error", value: plan };
        const [{ n } = { n: 0 }] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.automations)
          .where(
            and(eq(schema.automations.userId, ctx.userId), eq(schema.automations.enabled, true)),
          );
        if (n >= MAX_SCHEDULED)
          return {
            type: "error",
            value: `The user already has ${MAX_SCHEDULED} active automations. Cancel some first.`,
          };
        const [row] = await db
          .insert(schema.automations)
          .values({
            userId: ctx.userId,
            chatId: ctx.chatId,
            name: title,
            prompt: instructions,
            kind: i.kind,
            trigger: { type: "schedule" },
            ...plan,
          })
          .returning({ id: schema.automations.id });
        const shownZone = i.timezone?.trim() || timezone;
        const when = formatWhen(plan.nextRunAt, shownZone, String(i.when));
        const every = plan.schedule ? `, then ${repeatLabel(i.repeat) ?? plan.schedule}` : "";
        return {
          type: "text",
          value: `Scheduled ${i.kind} "${title}" (id ${row!.id}) for ${when}${shownZone ? ` ${shownZone}` : ""}${every}. ${
            i.kind === "reminder"
              ? "The user will be notified then."
              : "You will continue this conversation then."
          } It is listed under Automations, where the user can cancel it.`,
        };
      },
    },
    {
      name: "list_scheduled",
      description:
        "List the user's upcoming scheduled tasks and reminders (and recurring automations) with their next time and id. Also tells you the current time.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      effect: "read",
      untrustedOutput: false,
      source: "builtin",
      execute: async (_input, ctx) => {
        const rows = await db
          .select({
            id: schema.automations.id,
            name: schema.automations.name,
            kind: schema.automations.kind,
            schedule: schema.automations.schedule,
            timezone: schema.automations.timezone,
            runAt: schema.automations.runAt,
            nextRunAt: schema.automations.nextRunAt,
            chatId: schema.automations.chatId,
            chatTitle: schema.chats.title,
          })
          .from(schema.automations)
          .innerJoin(schema.chats, eq(schema.chats.id, schema.automations.chatId))
          .where(
            and(
              eq(schema.automations.userId, ctx.userId),
              eq(schema.automations.enabled, true),
              sql`${schema.automations.trigger}->>'type' = 'schedule'`,
            ),
          )
          .orderBy(asc(schema.automations.nextRunAt))
          .limit(50);
        const now = `Now: ${formatWhen(new Date(), timezone)}${timezone ? ` ${timezone}` : " UTC"} (${new Date().toISOString()}).`;
        if (rows.length === 0) return { type: "text", value: `${now}\nNothing is scheduled.` };
        const lines = rows.map((r) => {
          const next = r.nextRunAt ? formatWhen(r.nextRunAt, timezone ?? r.timezone) : "not set";
          const how = r.runAt ? "once" : `repeats: ${r.schedule} (${r.timezone})`;
          const where =
            r.chatId === ctx.chatId ? "this chat" : `chat "${r.chatTitle ?? "Untitled"}"`;
          return `- ${r.name} [${r.kind}, id ${r.id}]: next ${next}; ${how}; in ${where}`;
        });
        return { type: "text", value: [now, ...lines].join("\n") };
      },
    },
    {
      name: "cancel_scheduled",
      description:
        "Cancel one of the user's scheduled tasks, reminders or scheduled automations by id (from list_scheduled). It is paused, not deleted: the user can turn it back on under Automations.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      effect: "write",
      defaultDecision: "allow",
      untrustedOutput: false,
      source: "builtin",
      preview: (input) => `Cancel scheduled item ${(input as { id?: string }).id ?? ""}`,
      execute: async (input, ctx) => {
        const id = String((input as { id?: string }).id ?? "").trim();
        const [row] = await db
          .update(schema.automations)
          .set({ enabled: false, nextRunAt: null })
          .where(
            and(
              eq(schema.automations.id, id),
              eq(schema.automations.userId, ctx.userId),
              sql`${schema.automations.trigger}->>'type' = 'schedule'`,
            ),
          )
          .returning({ name: schema.automations.name });
        if (!row) return { type: "error", value: `No scheduled item with id ${id}.` };
        return { type: "text", value: `Cancelled "${row.name}".` };
      },
    },
  ];
}
