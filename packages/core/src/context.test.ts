import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { attachImages, clearOldToolOutputs, toModelOutput } from "./context";

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

describe("attachImages", () => {
  const image = (fileId: string) =>
    ({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: `c-${fileId}`,
          toolName: "file_read",
          output: toModelOutput({
            type: "image",
            fileId,
            name: `${fileId}.png`,
            mimeType: "image/png",
            bytes: 3,
          }),
        },
      ],
    }) satisfies ModelMessage;
  const parts = (m: ModelMessage) => {
    const r = (m.content as { output: { value: Record<string, unknown>[] } }[])[0]!;
    return r.output.value;
  };

  test("loads the newest images and turns older ones into a note", async () => {
    const msgs = ["a", "b", "c"].map(image);
    const loaded: string[] = [];
    const out = await attachImages(
      msgs,
      async (id) => {
        loaded.push(id);
        return { data: new Uint8Array([1, 2, 3]) };
      },
      2,
    );
    expect(loaded.sort()).toEqual(["b", "c"]);
    expect(parts(out[0]!)[1]).toEqual({
      type: "text",
      text: "[Image shown earlier; call file_read again to look at it.]",
    });
    expect(parts(out[2]!)[1]).toMatchObject({
      type: "file",
      mediaType: "image/png",
      data: { type: "data", data: new Uint8Array([1, 2, 3]) },
    });
    // Stored messages are untouched: the bytes only exist in the copy sent to the model.
    expect(parts(msgs[2]!)[1]).toMatchObject({ data: { type: "text", text: "" } });
  });

  test("a missing image, or no loader, becomes a note", async () => {
    const [gone] = await attachImages([image("x")], async () => null);
    expect(parts(gone!)[1]).toEqual({ type: "text", text: "[The image is no longer available.]" });
    const [none] = await attachImages([image("x")], undefined);
    expect(parts(none!)[1]).toEqual({ type: "text", text: "[Image not shown here.]" });
  });

  test("messages without images come back as they were", async () => {
    const msgs: ModelMessage[] = [{ role: "user", content: "hi" }];
    expect(await attachImages(msgs, async () => null)).toBe(msgs);
  });
});
