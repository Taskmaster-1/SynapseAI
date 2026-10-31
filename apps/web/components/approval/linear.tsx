"use client";

type Obj = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** "ENG-123" out of an identifier or a link to the issue. */
function issueRef(v: unknown): string {
  const s = str(v);
  return /\b[A-Za-z][A-Za-z0-9_]{0,9}-\d+\b/.exec(s)?.[0]?.toUpperCase() ?? (s || "an issue");
}

const PRIORITY: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-4 space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-3 sm:gap-4">
          <dt className="w-16 shrink-0 text-13 text-fg-muted">{k}</dt>
          <dd className="min-w-0 flex-1 text-14 [overflow-wrap:anywhere] text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Markdown shown as written: what Linear will render, without rendering it here. */
function Body({ text }: { text: string }) {
  return (
    <div className="scroll-thin mt-4 max-h-[360px] overflow-auto border-l-2 border-line-strong pl-3 text-14 leading-relaxed whitespace-pre-wrap break-words text-fg">
      {text || <span className="text-fg-faint italic">empty</span>}
    </div>
  );
}

/** A new Linear issue: the team it lands in, the title, its fields, then the description. */
export function LinearIssueView({ obj }: { obj: Obj }) {
  const labels = Array.isArray(obj.labels) ? obj.labels.map(String).filter(Boolean) : [];
  const rows: [string, string][] = [["Team", str(obj.team).toUpperCase() || "—"]];
  if (str(obj.state)) rows.push(["State", str(obj.state)]);
  if (str(obj.priority))
    rows.push(["Priority", PRIORITY[str(obj.priority).toLowerCase()] ?? str(obj.priority)]);
  if (str(obj.assignee))
    rows.push(["Assignee", str(obj.assignee).toLowerCase() === "me" ? "You" : str(obj.assignee)]);
  if (labels.length) rows.push(["Labels", labels.join(", ")]);
  rows.push(["As", "You, in Linear"]);
  return (
    <div>
      <p className="eyebrow mb-1.5">New Linear issue</p>
      <h3 className="font-serif text-[24px] leading-[1.15] break-words text-fg">
        {str(obj.title) || <span className="text-fg-faint italic">Untitled</span>}
      </h3>
      <Rows rows={rows} />
      <Body text={str(obj.description)} />
    </div>
  );
}

/** A comment as it will appear: on which issue, as you, then the text. */
export function LinearCommentView({ obj }: { obj: Obj }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">Linear comment</p>
      <Rows
        rows={[
          ["On", issueRef(obj.issue)],
          ["As", "You, seen by everyone following the issue"],
        ]}
      />
      <div className="mt-5 font-serif text-[20px] leading-[1.35] whitespace-pre-wrap break-words text-fg sm:text-[22px]">
        {str(obj.body) || <span className="text-fg-faint italic">empty</span>}
      </div>
    </div>
  );
}
