import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { clearOldToolOutputs } from "./context";

function history(toolMessages: number): ModelMessage[] {
  return Array.from({ length: toolMessages }, (_, i) => ({
    role: "tool" as const,
    content: [
      {
        type: "tool-result" as const,
        toolCallId: `c${i}`,
        toolName: "t",
        output: { type: "text" as const, value: `output ${i}` },
      },
    ],
  }));
}

const cleared = (messages: ModelMessage[]) =>
  messages.filter((m) => JSON.stringify(m).includes("output cleared")).length;

describe("clearOldToolOutputs", () => {
  test("keeps the most recent outputs", () => {
    expect(cleared(clearOldToolOutputs(history(10), 4))).toBe(6);
    expect(cleared(clearOldToolOutputs(history(3), 4))).toBe(0);
  });

  test("chunked clearing moves the boundary in steps so the cached prefix stays stable", () => {
    // 4 recent kept; the excess is cleared in multiples of 8.
    expect(cleared(clearOldToolOutputs(history(11), 4, 8))).toBe(0);
    expect(cleared(clearOldToolOutputs(history(12), 4, 8))).toBe(8);
    const a = clearOldToolOutputs(history(12), 4, 8);
    const b = clearOldToolOutputs(history(19), 4, 8);
    expect(JSON.stringify(b.slice(0, 12))).toBe(JSON.stringify(a));
  });
});
