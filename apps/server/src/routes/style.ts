import { Hono } from "hono";
import type { AppEnv } from "../http";
import { learnWritingStyle } from "../style";

/** Learning how the user writes from their sent mail; the result is an editable memory. */
export const writingStyle = new Hono<AppEnv>().post("/learn", async (c) => {
  const { memory, samples } = await learnWritingStyle(c.var.services, c.var.user.id);
  return c.json({
    memory: {
      id: memory.id,
      content: memory.content,
      source: memory.source,
      createdAt: memory.createdAt,
    },
    samples,
  });
});
