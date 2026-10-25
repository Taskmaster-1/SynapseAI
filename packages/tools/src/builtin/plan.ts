import { hashInput, type PlanGrant, type ToolDefinition } from "@synapse/core";
import { addPlanGrants, type Db, schema } from "@synapse/db";
import type { JSONValue } from "ai";
import { and, eq } from "drizzle-orm";

export const PLAN_TOOL = "propose_plan";
const MAX_STEPS = 25;

interface PlanStep {
  tool: string;
  input: Record<string, JSONValue>;
  why: string;
}

/**
 * Lets the agent ask for one sign-off on a multi-step job. The plan always needs approval;
 * the person can untick steps first (the approved input then holds only the kept steps).
 * Running it records one grant per kept step, so exactly that call, with exactly that
 * input, later runs once without asking again. Anything else goes through normal policy.
 */
export function planTool(db: Db): ToolDefinition {
  return {
    name: PLAN_TOOL,
    description: `Propose the exact actions you intend to take before a task that changes several things (sends, writes, deletes). The user reviews the list once, may remove steps, and approves. Afterwards, make exactly the approved calls with exactly the same inputs; they then run without asking again. Up to ${MAX_STEPS} steps. Do not include read-only steps.`,
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          maxLength: 500,
          description: "One sentence: what the plan does.",
        },
        steps: {
          type: "array",
          minItems: 1,
          maxItems: MAX_STEPS,
          items: {
            type: "object",
            properties: {
              tool: { type: "string", description: "Name of the tool to call." },
              input: { type: "object", description: "The exact input you will pass." },
              why: { type: "string", maxLength: 300, description: "Why this step is needed." },
            },
            required: ["tool", "input", "why"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "steps"],
      additionalProperties: false,
    },
    effect: "write",
    defaultDecision: "ask",
    untrustedOutput: false,
    source: "builtin",
    preview: (input) => String((input as { summary?: unknown }).summary ?? "").trim() || "A plan",
    execute: async (input, ctx) => {
      const steps = parseSteps(input);
      if (typeof steps === "string") return { type: "error", value: steps };

      // Grants only come from a person's sign-off. If a rule let the plan through without
      // one, the steps still ask one by one.
      const [call] = await db
        .select({ decidedBy: schema.toolCalls.decidedBy })
        .from(schema.toolCalls)
        .where(and(eq(schema.toolCalls.runId, ctx.runId), eq(schema.toolCalls.id, ctx.toolCallId)));
      if (!call?.decidedBy)
        return {
          type: "text",
          value:
            "The plan was noted but not signed off by the user, so each step will ask for approval when you make it.",
        };
      if (steps.length === 0)
        return {
          type: "text",
          value: "The user approved none of the steps. Do not make any of the proposed calls.",
        };

      const grants: PlanGrant[] = await Promise.all(
        steps.map(async (s) => ({ tool: s.tool, inputHash: await hashInput(s.input) })),
      );
      await addPlanGrants(db, ctx.runId, grants);
      const list = steps.map((s, i) => `${i + 1}. ${s.tool} ${JSON.stringify(s.input)}`).join("\n");
      return {
        type: "text",
        value: `The user approved these ${steps.length === 1 ? "step" : `${steps.length} steps`}:\n${list}\n\nNow make exactly these calls with exactly these inputs; they will run without asking again. Any change to a call means it asks again. If your plan had other steps, the user removed them: do not do them.`,
      };
    },
  };
}

function parseSteps(input: JSONValue): PlanStep[] | string {
  const steps = (input as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return "steps must be a list.";
  if (steps.length > MAX_STEPS) return `A plan can have at most ${MAX_STEPS} steps.`;
  for (const s of steps) {
    const step = s as Partial<PlanStep> | null;
    if (
      typeof step?.tool !== "string" ||
      typeof step.why !== "string" ||
      typeof step.input !== "object" ||
      step.input === null ||
      Array.isArray(step.input)
    )
      return "Each step needs a tool name, an input object and a why.";
    if (step.tool === PLAN_TOOL) return "A plan cannot contain another plan.";
  }
  return steps as PlanStep[];
}
