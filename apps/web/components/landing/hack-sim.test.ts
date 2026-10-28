/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { type CallStep, DEMO_TOOLS, PRESETS, simulate } from "./hack-sim";

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.email;
const calls = (id: string) => simulate(preset(id)).filter((s): s is CallStep => s.kind === "call");

describe("landing hack demo", () => {
  test("mirrors the real Gmail tools' effects and taint flags", async () => {
    // A variable path keeps the web typecheck out of the server-side tools package.
    const path = "../../../../packages/tools/src/google/gmail.ts";
    const { gmailTools } = (await import(path)) as {
      gmailTools: (c: () => Promise<never>) => {
        name: string;
        effect: string;
        untrustedOutput: boolean;
      }[];
    };
    const real = new Map(gmailTools(async () => undefined as never).map((t) => [t.name, t]));
    for (const [name, spec] of Object.entries(DEMO_TOOLS)) {
      const tool = real.get(name);
      expect(tool, name).toBeDefined();
      expect(tool!.effect).toBe(spec.effect);
      expect(tool!.untrustedOutput).toBe(spec.untrustedOutput);
    }
  });

  test("injection: reads run, the send is held, the delete is blocked", () => {
    const [search, read, send, trash] = calls("injection");
    expect(search!.verdict.decision).toBe("allow");
    expect(search!.taints).toBe(true);
    expect(read!.tainted).toBe(true);
    expect(read!.verdict.decision).toBe("allow");
    expect(send!.tool).toBe("gmail_send");
    expect(send!.input.to).toEqual(["attacker@evil.example"]);
    expect(send!.verdict.decision).toBe("ask");
    expect(trash!.verdict.decision).toBe("block");
    expect(trash!.verdict.reason).toBe("No deletes, ever.");
  });

  test("an address the learned rule allows still asks once the run is tainted", () => {
    const send = calls("insider").find((c) => c.tool === "gmail_send")!;
    expect(send.untainted.decision).toBe("allow");
    expect(send.verdict.decision).toBe("ask");
    expect(send.verdict.reason).toContain("read outside content");
  });

  test("a harmless email only reads", () => {
    const steps = simulate(preset("harmless"));
    expect(steps.filter((s) => s.kind === "call").every((s) => s.effect === "read")).toBe(true);
    expect(steps.at(-1)).toMatchObject({ kind: "end", outcome: "done" });
  });
});
