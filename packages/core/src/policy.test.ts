import { describe, expect, test } from "bun:test";
import { evaluatePolicy, globMatch, type PolicyRule } from "./policy";

const send = { tool: "gmail_send_email", effect: "send" as const, tainted: false };

describe("evaluatePolicy", () => {
  test("falls back to effect defaults", () => {
    expect(evaluatePolicy({ ...send, input: {} }, []).decision).toBe("ask");
    expect(
      evaluatePolicy({ tool: "web_search", effect: "read", input: {}, tainted: true }, []).decision,
    ).toBe("allow");
  });

  test("argument matchers scope an allow rule", () => {
    const rules: PolicyRule[] = [
      {
        id: "internal",
        tool: "gmail_*",
        decision: "allow",
        when: [{ path: "to", op: "allEndWith", value: ["@acme.com"] }],
      },
    ];
    expect(
      evaluatePolicy({ ...send, input: { to: ["a@acme.com", "b@ACME.com"] } }, rules).decision,
    ).toBe("allow");
    expect(
      evaluatePolicy({ ...send, input: { to: ["a@acme.com", "x@evil.com"] } }, rules).decision,
    ).toBe("ask");
    expect(evaluatePolicy({ ...send, input: { to: [] } }, rules).decision).toBe("ask");
  });

  test("block beats an earlier allow", () => {
    const rules: PolicyRule[] = [
      { id: "a", tool: "*", decision: "allow" },
      { id: "b", tool: "github_delete_*", decision: "block" },
    ];
    const r = evaluatePolicy(
      { tool: "github_delete_repo", effect: "destructive", input: {}, tainted: false },
      rules,
    );
    expect(r).toMatchObject({ decision: "block", ruleId: "b" });
  });

  test("taint downgrades allow to ask for non-read effects", () => {
    const rules: PolicyRule[] = [{ id: "a", tool: "*", decision: "allow" }];
    expect(evaluatePolicy({ ...send, input: {}, tainted: true }, rules).decision).toBe("ask");
    expect(evaluatePolicy({ ...send, input: {}, tainted: false }, rules).decision).toBe("allow");
  });

  test("invalid regex never matches", () => {
    const rules: PolicyRule[] = [
      { id: "a", tool: "*", decision: "block", when: [{ path: "q", op: "matches", value: "(" }] },
    ];
    expect(evaluatePolicy({ ...send, input: { q: "(" } }, rules).decision).toBe("ask");
  });
});

test("globMatch escapes regex metacharacters", () => {
  expect(globMatch("a.b", "aXb")).toBe(false);
  expect(globMatch("gmail_*", "gmail_send")).toBe(true);
});

test("tool default decision applies when no rule matches, taint still wins", () => {
  const call = {
    tool: "memory_save",
    effect: "write" as const,
    input: {},
    defaultDecision: "allow" as const,
  };
  expect(evaluatePolicy({ ...call, tainted: false }, []).decision).toBe("allow");
  expect(evaluatePolicy({ ...call, tainted: true }, []).decision).toBe("ask");
  expect(
    evaluatePolicy({ ...call, tainted: false }, [{ id: "x", tool: "memory_*", decision: "block" }])
      .decision,
  ).toBe("block");
});

test("patterns prone to catastrophic backtracking are refused and never match", () => {
  const { unsafePatternReason } = require("./policy") as typeof import("./policy");
  expect(unsafePatternReason("(a+)+$")).toContain("nested");
  expect(unsafePatternReason("(\\w*)*")).toContain("nested");
  expect(unsafePatternReason("(a)\\1")).toContain("backreference");
  expect(unsafePatternReason("^acme/[a-z-]+$")).toBeNull();
  const rules: PolicyRule[] = [
    {
      id: "r",
      tool: "*",
      decision: "block",
      when: [{ path: "q", op: "matches", value: "(a+)+$" }],
    },
  ];
  const started = performance.now();
  expect(evaluatePolicy({ ...send, input: { q: `${"a".repeat(40)}b` } }, rules).decision).toBe(
    "ask",
  );
  expect(performance.now() - started).toBeLessThan(50);
});
