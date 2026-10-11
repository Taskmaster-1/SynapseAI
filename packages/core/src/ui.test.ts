import { expect, test } from "bun:test";
import { MemoryEvents, MemoryStore } from "./memory-store";
import { runAgent } from "./runtime";
import { scriptedModel } from "./testing";
import { ToolRegistry } from "./tools";
import { applyEvent, type ChatState, toUiMessages } from "./ui";

const tools = new ToolRegistry([
  {
    name: "lookup",
    description: "x",
    inputSchema: { type: "object" },
    effect: "read",
    untrustedOutput: false,
    source: "t",
    execute: async () => ({ type: "text", value: "42" }),
  },
  {
    name: "post",
    description: "x",
    inputSchema: { type: "object" },
    effect: "send",
    untrustedOutput: false,
    source: "t",
    execute: async () => ({ type: "text", value: "posted" }),
  },
]);

test("live events converge to the same chat as the stored rows", async () => {
  const store = new MemoryStore();
  const events = new MemoryEvents();
  const run = store.createRun({ chatId: "c", userId: "u", text: "go" });
  const model = scriptedModel([
    { text: "Looking it up.", toolCalls: [{ name: "lookup", input: {}, id: "a" }] },
    { text: "Posting.", toolCalls: [{ name: "post", input: { x: 1 }, id: "b" }] },
    { text: "Done: 42." },
  ]);
  const opts = { runId: run.id, store, events, tools, models: [model], system: "s" };
  await runAgent(opts);
  store.decide("b", true);
  await runAgent(opts);

  const userRow = store.messages[0]!;
  let state: ChatState = { messages: toUiMessages([userRow], []), run: null };
  events.events.forEach((e, i) => {
    state = applyEvent(state, { ...e, seq: i + 1 });
  });
  // Replaying the whole log again is a no-op.
  const replayed = events.events.reduce((s, e, i) => applyEvent(s, { ...e, seq: i + 1 }), state);
  expect(replayed).toBe(state);

  const stored = toUiMessages(store.messages, await store.listToolCalls(run.id));
  const strip = (s: typeof stored) =>
    s.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts.map((p) => (p.type === "tool" ? { ...p, preview: null } : p)),
    }));
  expect(strip(state.messages)).toEqual(strip(stored));
  expect(state.run).toMatchObject({ status: "completed" });
  expect(stored.at(-1)!.parts).toEqual([{ type: "text", text: "Done: 42." }]);
});
