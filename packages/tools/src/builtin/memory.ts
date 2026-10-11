import type { ToolDefinition } from "@synapse/core";
import { type Db, schema } from "@synapse/db";
import { and, asc, eq, sql } from "drizzle-orm";

const MAX_MEMORIES = 200;
const MAX_MEMORY_CHARS = 500;

/**
 * Long-term memory is a short list of plain-text notes the user can see and edit.
 * Saving runs without approval by default, but like every non-read tool it asks once the
 * run has seen untrusted content, so an injected email cannot plant memories silently.
 */
export function memoryTools(db: Db): ToolDefinition[] {
  return [
    {
      name: "memory_save",
      description:
        "Save a durable fact or preference about the user for future conversations (e.g. 'Prefers replies in British English'). Only save things the user said or clearly confirmed. Keep each note short.",
      inputSchema: {
        type: "object",
        properties: { note: { type: "string", maxLength: MAX_MEMORY_CHARS } },
        required: ["note"],
        additionalProperties: false,
      },
      effect: "write",
      defaultDecision: "allow",
      untrustedOutput: false,
      source: "builtin",
      preview: (input) => `Remember: ${(input as { note: string }).note}`,
      execute: async (input, ctx) => {
        const note = String((input as { note: string }).note)
          .trim()
          .slice(0, MAX_MEMORY_CHARS);
        if (!note) return { type: "error", value: "Empty note." };
        const [{ n } = { n: 0 }] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.memories)
          .where(eq(schema.memories.userId, ctx.userId));
        if (n >= MAX_MEMORIES)
          return {
            type: "error",
            value: "Memory is full. Ask the user to remove old notes in Settings.",
          };
        await db
          .insert(schema.memories)
          .values({ userId: ctx.userId, content: note, source: "agent" });
        return { type: "text", value: "Saved." };
      },
    },
  ];
}

/** Renders the user's notes for the system prompt. */
export async function loadMemoryBlock(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select({ content: schema.memories.content })
    .from(schema.memories)
    .where(and(eq(schema.memories.userId, userId)))
    .orderBy(asc(schema.memories.createdAt))
    .limit(MAX_MEMORIES);
  if (rows.length === 0) return null;
  return rows.map((r) => `- ${r.content}`).join("\n");
}
