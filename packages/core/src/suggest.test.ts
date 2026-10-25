import { describe, expect, test } from "bun:test";
import type { JSONValue } from "ai";
import { evaluatePolicy, type PolicyRule } from "./policy";
import { type PastDecision, suggestionId, suggestRules } from "./suggest";
import type { Effect } from "./types";

let clock = Date.parse("2026-10-01T00:00:00Z");

function decision(
  tool: string,
  effect: Effect,
  input: JSONValue,
  extra: Partial<PastDecision> = {},
): PastDecision {
  clock += 60_000;
  return {
    tool,
    effect,
    input,
    inputEdited: false,
    approved: true,
    decidedAt: new Date(clock),
    preview: null,
    ...extra,
  };
}

const email = (to: string | string[], extra: Partial<PastDecision> = {}) =>
  decision("gmail_send", "send", { to, subject: "Hi", body: "…" }, extra);

const times = <T>(n: number, fn: (i: number) => T) => Array.from({ length: n }, (_, i) => fn(i));

describe("suggestRules", () => {
  test("needs five unedited approvals", () => {
    const four = times(4, (i) => email(`p${i}@acme.com`));
    expect(suggestRules(four, [])).toEqual([]);
    const five = [...four, email("q@acme.com", { preview: "Email q@acme.com" })];
    const [s] = suggestRules(five, []);
    expect(s).toMatchObject({
      tool: "gmail_send",
      effect: "send",
      count: 5,
      when: [{ path: "to", op: "allEndWith", value: ["@acme.com"] }],
      label: "emails to @acme.com",
      sentence: "You approved 5 emails to @acme.com without changes.",
      note: "Learned: you approved 5 of these",
    });
    expect(s!.examples[0]).toBe("Email q@acme.com");
    expect(s!.examples.length).toBeLessThanOrEqual(3);
  });

  test("edited approvals don't count toward the total", () => {
    const old = times(3, () => email("a@acme.com", { inputEdited: true }));
    const recent = times(10, () => email("a@acme.com"));
    expect(suggestRules([...old, ...recent], [])[0]!.count).toBe(10);
  });

  test("a recent denial or edit suppresses the suggestion", () => {
    const base = times(8, () => email("a@acme.com"));
    expect(suggestRules(base, [])).toHaveLength(1);
    expect(suggestRules([...base, email("a@acme.com", { approved: false })], [])).toEqual([]);
    expect(suggestRules([...base, email("a@acme.com", { inputEdited: true })], [])).toEqual([]);
  });

  test("a denial older than the last ten decisions no longer suppresses", () => {
    const old = email("a@acme.com", { approved: false });
    const later = times(10, () => email("a@acme.com"));
    expect(suggestRules([old, ...later], [])).toHaveLength(1);
  });

  test("mixed domains give no domain matcher; a send tool then gets no suggestion", () => {
    const list = [...times(4, () => email(["a@acme.com"])), email(["a@acme.com", "x@other.io"])];
    expect(suggestRules(list, [])).toEqual([]);
  });

  test("public mail domains and optional recipient fields don't generalize", () => {
    expect(
      suggestRules(
        times(6, (i) => email(`f${i}@gmail.com`)),
        [],
      ),
    ).toEqual([]);
    const someCc = times(6, (i) =>
      decision("gmail_send", "send", {
        to: "a@acme.com",
        ...(i % 2 ? { cc: ["b@acme.com"] } : {}),
      }),
    );
    expect(suggestRules(someCc, [])).toEqual([]);
  });

  test("every recipient field is constrained", () => {
    const list = times(5, () =>
      decision("gmail_send", "send", { to: "a@acme.com", cc: ["b@acme.com", "c@ACME.com"] }),
    );
    expect(suggestRules(list, [])[0]!.when).toEqual([
      { path: "to", op: "allEndWith", value: ["@acme.com"] },
      { path: "cc", op: "allEndWith", value: ["@acme.com"] },
    ]);
  });

  test("a single repo or channel becomes an equals matcher", () => {
    const list = times(5, (i) =>
      decision("github_create_issue", "write", { repo: "acme/web", title: `Bug ${i}` }),
    );
    const [s] = suggestRules(list, []);
    expect(s!.when).toEqual([{ path: "repo", op: "equals", value: "acme/web" }]);
    expect(s!.label).toBe("github_create_issue actions in acme/web");
  });

  test("write tools without a safe constraint get a tool-wide suggestion", () => {
    const list = times(5, (i) => decision("memory_save", "write", { note: `n${i}` }));
    expect(suggestRules(list, [])[0]).toMatchObject({ tool: "memory_save", when: [] });
  });

  test("destructive without a constraint gets none; with one it does", () => {
    const loose = times(6, (i) =>
      decision("gmail_trash", "destructive", { messageIds: [`m${i}`] }),
    );
    expect(suggestRules(loose, [])).toEqual([]);
    const scoped = times(6, (i) =>
      decision("github_delete_branch", "destructive", { repo: "acme/web", branch: `b${i}` }),
    );
    expect(suggestRules(scoped, [])[0]!.when).toEqual([
      { path: "repo", op: "equals", value: "acme/web" },
    ]);
  });

  test("reads are ignored", () => {
    expect(
      suggestRules(
        times(9, () => decision("web_search", "read", { q: "x" })),
        [],
      ),
    ).toEqual([]);
  });

  test("an existing equal or broader allow rule suppresses it; narrower or ask does not", () => {
    const list = times(6, () => email("a@acme.com"));
    const rule = (r: Partial<PolicyRule>): PolicyRule => ({
      id: "r",
      tool: "gmail_send",
      decision: "allow",
      ...r,
    });
    expect(suggestRules(list, [rule({})])).toEqual([]);
    expect(suggestRules(list, [rule({ tool: "gmail_*" })])).toEqual([]);
    expect(
      suggestRules(list, [
        rule({ when: [{ path: "to", op: "allEndWith", value: ["@ACME.com"] }] }),
      ]),
    ).toEqual([]);
    expect(
      suggestRules(list, [
        rule({
          when: [
            { path: "to", op: "allEndWith", value: ["@acme.com"] },
            { path: "subject", op: "equals", value: "Hi" },
          ],
        }),
      ]),
    ).toHaveLength(1);
    expect(suggestRules(list, [rule({ decision: "ask" })])).toHaveLength(1);
  });

  test("dismissed suggestions stay hidden", () => {
    const list = times(6, () => email("a@acme.com"));
    const [s] = suggestRules(list, []);
    expect(suggestRules(list, [], [s!.id])).toEqual([]);
    expect(suggestRules(list, [], ["sg_other"])).toHaveLength(1);
  });

  test("ids are stable and differ by tool and matchers", () => {
    const m = [{ path: "to", op: "allEndWith" as const, value: ["@acme.com"] }];
    expect(suggestionId("gmail_send", m)).toBe(suggestionId("gmail_send", structuredClone(m)));
    expect(suggestionId("gmail_send", m)).toMatch(/^sg_[0-9a-f]{16}$/);
    expect(suggestionId("gmail_send", m)).not.toBe(suggestionId("gmail_create_draft", m));
    expect(suggestionId("gmail_send", m)).not.toBe(
      suggestionId("gmail_send", [{ ...m[0]!, value: ["@other.io"] }]),
    );
    const a = suggestRules(
      times(5, () => email("a@acme.com")),
      [],
    );
    const b = suggestRules(
      times(7, () => email("z@acme.com")),
      [],
    );
    expect(a[0]!.id).toBe(b[0]!.id);
  });

  test("the accepted rule allows matching calls, but never in a tainted run", () => {
    const [s] = suggestRules(
      times(5, () => email("a@acme.com")),
      [],
    );
    const rule: PolicyRule = { id: "l", tool: s!.tool, decision: "allow", when: s!.when };
    const call = { tool: "gmail_send", effect: "send" as const };
    expect(
      evaluatePolicy({ ...call, input: { to: "b@acme.com" }, tainted: false }, [rule]).decision,
    ).toBe("allow");
    expect(
      evaluatePolicy({ ...call, input: { to: "b@evil.com" }, tainted: false }, [rule]).decision,
    ).toBe("ask");
    expect(
      evaluatePolicy({ ...call, input: { to: "b@acme.com" }, tainted: true }, [rule]).decision,
    ).toBe("ask");
  });
});
