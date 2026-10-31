"use client";

import type { ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import { Value } from "./payload";

type Obj = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

/** Fields the tailored view doesn't show, so nothing the agent sent goes unseen. */
function Rest({ obj, known }: { obj: Obj; known: string[] }) {
  const rest = Object.fromEntries(Object.entries(obj).filter(([k]) => !known.includes(k)));
  if (Object.keys(rest).length === 0) return null;
  return (
    <div className="mt-5 border-t border-dashed border-line-strong pt-4">
      <Value value={rest} />
    </div>
  );
}

/** Markdown as GitHub will show it, from text the agent wrote (no HTML, no remote images). */
function Body({ text }: { text: string }) {
  if (!text) return <span className="text-fg-faint italic">empty</span>;
  return (
    <div className="scroll-thin max-h-[420px] overflow-auto border-l-2 border-line-strong pl-3 text-14">
      <Markdown text={text} />
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 sm:gap-4">
      <dt className="w-14 shrink-0 text-13 text-fg-muted sm:w-16">{k}</dt>
      <dd className="min-w-0 flex-1 text-14 [overflow-wrap:anywhere] text-fg">{children}</dd>
    </div>
  );
}

/** A comment as it will land: on which issue or PR, as you, then the Markdown. */
export function GitHubCommentView({ obj }: { obj: Obj }) {
  const where = `${str(obj.repo) || "?"}#${String(obj.number ?? "?")}`;
  return (
    <div>
      <dl className="space-y-1.5">
        <Row k="On">
          <span className="font-mono font-medium">{where}</span>
        </Row>
        <Row k="As">You, on GitHub</Row>
      </dl>
      <div className="mt-4">
        <Body text={str(obj.body)} />
      </div>
      <Rest obj={obj} known={["repo", "number", "body"]} />
    </div>
  );
}

/** A new issue reads like one: repository, title, labels and assignees, then the body. */
export function GitHubIssueView({ obj }: { obj: Obj }) {
  const labels = strings(obj.labels);
  const assignees = strings(obj.assignees);
  return (
    <div>
      <p className="eyebrow mb-1.5">
        New issue in <span className="font-mono normal-case">{str(obj.repo) || "?"}</span>
      </p>
      <h3 className="font-serif text-[24px] leading-[1.15] break-words text-fg">
        {str(obj.title) || <span className="text-fg-faint italic">Untitled</span>}
      </h3>
      {labels.length || assignees.length ? (
        <dl className="mt-3 space-y-1.5">
          {labels.length ? (
            <Row k="Labels">
              <span className="flex flex-wrap gap-1">
                {labels.map((l) => (
                  <span key={l} className="rounded-full bg-sunken px-2.5 py-px text-13">
                    {l}
                  </span>
                ))}
              </span>
            </Row>
          ) : null}
          {assignees.length ? (
            <Row k="Assign">{assignees.map((a) => `@${a.replace(/^@/, "")}`).join(", ")}</Row>
          ) : null}
        </dl>
      ) : null}
      <div className="mt-4">
        <Body text={str(obj.body)} />
      </div>
      <Rest obj={obj} known={["repo", "title", "body", "labels", "assignees"]} />
    </div>
  );
}
