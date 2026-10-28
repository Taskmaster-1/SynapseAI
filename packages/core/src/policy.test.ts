import { describe, expect, test } from "bun:test";
import {
  ADMIN_APPROVAL_REASON,
  evaluateComposedPolicy,
  evaluatePolicy,
  globMatch,
  type PolicyRule,
  planGrantMaySatisfy,
  type TeamPolicyRule,
} from "./policy";

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

describe("evaluateComposedPolicy (team rules)", () => {
  const sendCall = { ...send, input: { to: "bob@acme.com" } };

  test("with no team rules it is exactly evaluatePolicy", () => {
    const rules: PolicyRule[] = [
      { id: "a", tool: "gmail_*", decision: "allow" },
      { id: "b", tool: "github_delete_*", decision: "block" },
    ];
    const calls = [
      sendCall,
      { ...sendCall, tainted: true },
      { tool: "github_delete_repo", effect: "destructive" as const, input: {}, tainted: false },
      { tool: "web_search", effect: "read" as const, input: {}, tainted: true },
    ];
    for (const call of calls) {
      expect(evaluateComposedPolicy(call, { rules })).toEqual({
        ...evaluatePolicy(call, rules),
        approver: null,
        source: "personal",
      });
      expect(evaluateComposedPolicy(call, { rules }, [])).toEqual(
        evaluateComposedPolicy(call, { rules }),
      );
    }
  });

  test("a team block beats a personal allow", () => {
    const r = evaluateComposedPolicy(
      sendCall,
      { rules: [{ id: "mine", tool: "*", decision: "allow" }] },
      [{ id: "team", tool: "gmail_*", decision: "block" }],
    );
    expect(r).toMatchObject({ decision: "block", ruleId: "team", source: "team" });
    expect(r.reason).toContain("team");
  });

  test("a team block can't be overridden by an earlier team allow either", () => {
    const r = evaluateComposedPolicy(sendCall, { rules: [] }, [
      { id: "ok", tool: "*", decision: "allow" },
      { id: "no", tool: "gmail_send_*", decision: "block" },
    ]);
    expect(r).toMatchObject({ decision: "block", ruleId: "no" });
  });

  test("a personal ask beats a team allow; a personal block beats a team ask", () => {
    expect(
      evaluateComposedPolicy(
        sendCall,
        { rules: [{ id: "mine", tool: "gmail_*", decision: "ask" }] },
        [{ id: "team", tool: "*", decision: "allow" }],
      ),
    ).toMatchObject({ decision: "ask", ruleId: "mine", approver: null, source: "personal" });
    // Personal defaults count too: a team allow doesn't loosen "sending asks".
    expect(
      evaluateComposedPolicy(sendCall, { rules: [] }, [
        { id: "team", tool: "*", decision: "allow" },
      ]).decision,
    ).toBe("ask");
    expect(
      evaluateComposedPolicy(
        sendCall,
        { rules: [{ id: "mine", tool: "gmail_*", decision: "block" }] },
        [{ id: "team", tool: "*", decision: "ask", approver: "admin" }],
      ),
    ).toMatchObject({ decision: "block", ruleId: "mine", approver: null });
  });

  test("a team admin-ask beats a personal allow and taint", () => {
    const team: TeamPolicyRule[] = [
      { id: "t", tool: "gmail_*", decision: "ask", approver: "admin" },
    ];
    const personal = { rules: [{ id: "mine", tool: "*", decision: "allow" as const }] };
    for (const tainted of [false, true]) {
      expect(evaluateComposedPolicy({ ...sendCall, tainted }, personal, team)).toEqual({
        decision: "ask",
        approver: "admin",
        reason: ADMIN_APPROVAL_REASON,
        ruleId: "t",
        source: "team",
      });
    }
    // An ordinary team ask has no approver: the member decides.
    expect(
      evaluateComposedPolicy(sendCall, personal, [{ id: "t", tool: "gmail_*", decision: "ask" }]),
    ).toMatchObject({ decision: "ask", approver: null, source: "team" });
    // An approver on a non-ask rule means nothing.
    expect(
      evaluateComposedPolicy({ ...sendCall, effect: "read" }, personal, [
        { id: "t", tool: "gmail_*", decision: "allow", approver: "admin" },
      ]),
    ).toMatchObject({ decision: "allow", approver: null });
  });

  test("taint still turns a combined allow into an ordinary ask", () => {
    const r = evaluateComposedPolicy(
      { ...sendCall, tainted: true },
      { rules: [{ id: "mine", tool: "*", decision: "allow" }] },
      [{ id: "team", tool: "*", decision: "allow" }],
    );
    expect(r).toMatchObject({ decision: "ask", approver: null });
    expect(r.reason).toContain("outside content");
  });

  test("team rules only apply where their matchers hold", () => {
    const team: TeamPolicyRule[] = [
      {
        id: "outside",
        tool: "gmail_*",
        decision: "ask",
        approver: "admin",
        when: [{ path: "to", op: "allEndWith", value: ["@acme.com"] }],
      },
    ];
    const personal = { rules: [{ id: "mine", tool: "*", decision: "allow" as const }] };
    expect(evaluateComposedPolicy(sendCall, personal, team).approver).toBe("admin");
    expect(
      evaluateComposedPolicy({ ...sendCall, input: { to: "x@evil.com" } }, personal, team),
    ).toMatchObject({ decision: "allow", approver: null });
  });

  test("plan grants satisfy ordinary asks only, never a block or an admin ask", () => {
    expect(planGrantMaySatisfy({ decision: "ask", approver: null })).toBe(true);
    expect(planGrantMaySatisfy({ decision: "allow", approver: null })).toBe(true);
    expect(planGrantMaySatisfy({ decision: "ask", approver: "admin" })).toBe(false);
    expect(planGrantMaySatisfy({ decision: "block", approver: null })).toBe(false);
  });
});
