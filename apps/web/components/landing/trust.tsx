import {
  ArrowDown,
  ArrowRight,
  Database,
  EyeOff,
  FileDown,
  KeyRound,
  Lock,
  ScrollText,
  Server,
  ShieldAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { EffectPill } from "@/components/ui";
import { MarketingFrame } from "./chrome";
import { GITHUB } from "./github";
import { Reveal } from "./reveal";
import { Eyebrow } from "./sections";

const H2 = "font-serif text-[clamp(38px,4.6vw,64px)] leading-[0.98] tracking-[-0.02em]";

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className = "bg-paper",
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-24 ${className}`}>
      <div className="mx-auto max-w-[1120px] px-5 py-20 sm:px-8 lg:py-28">
        <Reveal className="max-w-[760px]">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 id={`${id}-title`} className={`mt-4 ${H2}`}>
            {title}
          </h2>
          {intro && (
            <div className="mt-5 text-[17px] leading-[1.6] text-fg-muted [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4">
              {intro}
            </div>
          )}
        </Reveal>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

// ── The pipeline diagram ─────────────────────────────────────────────────────

const STAGES: {
  n: string;
  title: string;
  body: ReactNode;
  exit?: { label: string; tone: string };
}[] = [
  {
    n: "1",
    title: "Effect",
    body: (
      <>
        Every tool declares what it does. MCP tools that declare nothing count as destructive until
        you say otherwise.
        <span className="mt-3 flex flex-wrap gap-1">
          <EffectPill effect="read" />
          <EffectPill effect="write" />
          <EffectPill effect="send" />
          <EffectPill effect="destructive" />
        </span>
      </>
    ),
  },
  {
    n: "2",
    title: "Rules",
    body: "Your rules, then your defaults, plus your team's rules. A matching block wins outright; between you and your team, the strictest answer wins.",
    exit: { label: "Block: never runs, the agent is told why", tone: "text-danger" },
  },
  {
    n: "3",
    title: "Taint",
    body: "Has this task read an email, a web page, a document or an MCP result? Then an allow for anything but a read becomes an ask.",
  },
  {
    n: "4",
    title: "Approval",
    body: "You, or an admin if a team rule says so, see the exact payload. Approve, edit, or deny with a reason, from the app, your phone, Slack or email.",
    exit: { label: "Deny: never runs", tone: "text-danger" },
  },
  {
    n: "5",
    title: "Undo window",
    body: "Approved sends and deletes wait a few seconds (10 by default) before they run, with an Undo button.",
    exit: { label: "Undo: never runs", tone: "text-danger" },
  },
];

function Pipeline() {
  return (
    <figure>
      <div className="flex items-center gap-3 rounded-[14px] border border-dashed border-ink/25 px-4 py-3 text-[15px]">
        <span className="font-mono text-[12px] tracking-[0.12em] uppercase opacity-60">Model</span>
        proposes a tool call, e.g.{" "}
        <code className="font-mono text-[13px]">gmail_send(to: bob@acme.com, …)</code>
      </div>
      <ArrowDown className="mx-auto my-2 size-5 opacity-40" aria-hidden="true" />
      <ol className="grid gap-3 lg:grid-cols-5 lg:gap-0">
        {STAGES.map((s, i) => (
          <li key={s.n} className="relative flex flex-col lg:pr-6">
            <div className="flex-1 rounded-[14px] bg-surface p-4 shadow-[var(--slip-shadow)]">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[12px] opacity-50">0{s.n}</span>
                <h3 className="font-serif text-[26px] leading-none">{s.title}</h3>
              </div>
              <div className="mt-3 text-[14px] leading-relaxed text-fg-muted">{s.body}</div>
            </div>
            {s.exit && (
              <p className={`mt-2 flex items-start gap-1.5 text-[13px] font-medium ${s.exit.tone}`}>
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {s.exit.label}
              </p>
            )}
            {i < STAGES.length - 1 && (
              <>
                <ArrowRight
                  className="absolute top-8 right-0.5 hidden size-5 opacity-40 lg:block"
                  aria-hidden="true"
                />
                <ArrowDown
                  className="mx-auto mt-2 size-5 opacity-40 lg:hidden"
                  aria-hidden="true"
                />
              </>
            )}
          </li>
        ))}
      </ol>
      <ArrowDown className="mx-auto my-2 size-5 opacity-40" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] bg-ink px-4 py-3 text-[15px] text-paper">
        <span className="font-mono text-[12px] tracking-[0.12em] uppercase opacity-60">Runs</span>
        and is logged: the call, the verdict and its reason, who decided and from where.
      </div>
      <figcaption className="mt-5 max-w-[760px] text-[14px] leading-relaxed text-fg-muted">
        Calls the rules allow skip steps 4 and 5. A step of a plan you approved counts as your
        approval for that exact call, but never overrides a block or a team rule that needs an
        admin. The policy is <code className="font-mono">evaluateComposedPolicy</code> in{" "}
        <a
          className="text-accent underline underline-offset-4"
          href={`${GITHUB}/blob/main/packages/core/src/policy.ts`}
        >
          packages/core/src/policy.ts
        </a>
        : plain functions, no model involved.
      </figcaption>
    </figure>
  );
}

// ── Permission model ─────────────────────────────────────────────────────────

const COMBINE: [string, string, string][] = [
  ["block", "anything", "Block. A team block can never be overridden."],
  ["ask, an admin decides", "allow or ask", "Ask, and a team admin decides."],
  ["ask", "allow", "Ask, and you decide."],
  ["allow", "ask", "Ask. A team allow never loosens your own policy."],
  ["no matching rule", "anything", "Your policy decides."],
  ["anything", "block", "Block."],
];

function Permissions() {
  return (
    <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="space-y-6 text-[15px] leading-relaxed">
        <div>
          <h3 className="text-[18px] font-semibold">Defaults</h3>
          <ul className="mt-3 space-y-2">
            <li className="flex items-center gap-2">
              <EffectPill effect="read" /> allowed
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <EffectPill effect="write" /> <EffectPill effect="send" />{" "}
              <EffectPill effect="destructive" /> ask you
            </li>
          </ul>
        </div>
        <div>
          <h3 className="text-[18px] font-semibold">Your rules</h3>
          <p className="mt-2 text-fg-muted">
            Allow, ask or block, per tool and per argument (“email where every address is
            @acme.com”). Any matching block wins; otherwise the first match decides. Rule patterns
            prone to runaway backtracking are refused.
          </p>
        </div>
        <div>
          <h3 className="text-[18px] font-semibold">Learned rules</h3>
          <p className="mt-2 text-fg-muted">
            Suggested after repeated, unedited approvals. They are ordinary rules: visible, and
            removable. They can't weaken taint.
          </p>
        </div>
      </div>
      <div className="min-w-0">
        <h3 className="text-[18px] font-semibold">In a team, the strictest answer wins</h3>
        <p className="mt-2 font-mono text-[13px] text-fg-muted">
          block &gt; ask, an admin decides &gt; ask &gt; allow
        </p>
        <div className="mt-4 overflow-x-auto rounded-[14px] border border-ink/10 bg-surface">
          <table className="w-full min-w-[480px] text-left text-[14px]">
            <thead className="text-fg-muted">
              <tr className="border-b border-ink/10">
                <th className="px-4 py-2.5 font-medium">Team says</th>
                <th className="px-4 py-2.5 font-medium">You say</th>
                <th className="px-4 py-2.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {COMBINE.map(([team, you, result]) => (
                <tr key={team + you} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-2.5 font-mono text-[13px]">{team}</td>
                  <td className="px-4 py-2.5 font-mono text-[13px]">{you}</td>
                  <td className="px-4 py-2.5">{result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[14px] text-fg-muted">
          Taint applies after combining: an allowed non-read in a tainted task becomes an ordinary
          ask. Details in{" "}
          <a
            className="text-accent underline underline-offset-4"
            href={`${GITHUB}/blob/main/docs/teams.md`}
          >
            docs/teams.md
          </a>
          .
        </p>
      </div>
    </div>
  );
}

// ── Data ─────────────────────────────────────────────────────────────────────

const DATA: { icon: typeof Server; title: string; body: ReactNode }[] = [
  {
    icon: Server,
    title: "On your server",
    body: "Synapse is self-hosted: one Docker Compose file, or Bun on any machine. There is no hosted service between you and it.",
  },
  {
    icon: Database,
    title: "In your Postgres",
    body: "Tasks, approvals, rules, memory and the activity log live in one Postgres database you run (or embedded PGlite when trying it out).",
  },
  {
    icon: KeyRound,
    title: "Your model keys",
    body: "Bring your own Anthropic, OpenAI, Google, AI Gateway or OpenAI-compatible key. Keys and OAuth tokens are encrypted at rest (AES-256-GCM) and write-only through the API.",
  },
  {
    icon: EyeOff,
    title: "No telemetry",
    body: (
      <>
        Synapse doesn't report usage anywhere. Its auth library's telemetry is switched off, and the
        Docker image disables Next.js telemetry. It talks only to services you configure, plus a
        daily download of public model prices, which{" "}
        <code className="font-mono text-[13px]">SYNAPSE_PRICE_SYNC=false</code> turns off.
      </>
    ),
  },
];

function DataWhere() {
  return (
    <ul className="grid gap-5 sm:grid-cols-2">
      {DATA.map((x) => (
        <li key={x.title} className="rounded-[16px] border border-ink/10 bg-surface p-6">
          <x.icon className="size-5" strokeWidth={1.7} aria-hidden="true" />
          <h3 className="mt-4 text-[18px] font-semibold">{x.title}</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-fg-muted">{x.body}</p>
        </li>
      ))}
    </ul>
  );
}

// ── Audit ────────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  "time",
  "member",
  "task",
  "tool",
  "effect",
  "decision",
  "status",
  "decided_by",
  "decided_via",
  "reason",
];

function Audit() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-[16px] border border-ink/10 bg-surface p-6">
        <ScrollText className="size-5" strokeWidth={1.7} aria-hidden="true" />
        <h3 className="mt-4 text-[18px] font-semibold">Activity log</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-fg-muted">
          Every run and tool call, what the rules said and why, who approved or denied it, which
          model ran, tokens and cost. Each task also ends with a receipt.
        </p>
      </div>
      <div className="min-w-0 rounded-[16px] border border-ink/10 bg-surface p-6">
        <FileDown className="size-5" strokeWidth={1.7} aria-hidden="true" />
        <h3 className="mt-4 text-[18px] font-semibold">Team audit export</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-fg-muted">
          Owners and admins can download a CSV of every action proposed in members' tasks. Cells
          that could run as spreadsheet formulas are escaped.
        </p>
        <p className="mt-3 overflow-x-auto font-mono text-[12px] whitespace-nowrap text-fg-faint">
          {CSV_COLUMNS.join(",")}
        </p>
      </div>
    </div>
  );
}

// ── Limits ───────────────────────────────────────────────────────────────────

const LIMITS: [string, string][] = [
  [
    "It governs only what it runs.",
    "The policy sees the tools Synapse calls. Anything an MCP server or a connected app does on its own, or a key you use elsewhere, is outside it.",
  ],
  [
    "The model can still be fooled.",
    "Prompt injection can make the agent propose the wrong thing, or write a misleading draft. Taint makes sure it asks; you still have to read what you approve.",
  ],
  [
    "Reads run freely.",
    "In a tainted task a fooled model could still put data into a web search or a URL it fetches, since those are reads. If that matters, add a rule that asks before web_fetch and web_search.",
  ],
  [
    "Rules you add are rules you trust.",
    "Allow rules and learned rules let matching actions run without asking in tasks that haven't read outside content, and an approved plan step runs as written. Keep them narrow.",
  ],
  [
    "Tool labels can be wrong.",
    "MCP read-only and destructive hints come from the server. Unlabelled tools are treated as destructive, and you can override any tool's effect.",
  ],
  [
    "Undo is short, and then it's done.",
    "Once an email is sent or an action runs, Synapse can't recall it. The window is configurable and can be turned off.",
  ],
];

function Limits() {
  return (
    <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
      {LIMITS.map(([t, b]) => (
        <div key={t} className="border-t border-paper/20 pt-5">
          <dt className="font-serif text-[24px] leading-snug">{t}</dt>
          <dd className="mt-2 text-[15px] leading-relaxed text-paper/70">{b}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TrustPage({ stars }: { stars: number | null }) {
  return (
    <MarketingFrame home="/welcome" stars={stars}>
      <section className="bg-paper">
        <div className="mx-auto max-w-[1120px] px-5 pt-16 pb-8 sm:px-8 lg:pt-24">
          <Eyebrow className="landing-rise">Trust</Eyebrow>
          <h1 className="landing-rise mt-5 max-w-[900px] font-serif text-[clamp(48px,7vw,96px)] leading-[0.95] tracking-[-0.025em]">
            How Synapse keeps an agent <span className="text-accent italic">on a short leash.</span>
          </h1>
          <p className="landing-rise mt-7 max-w-[640px] text-[18px] leading-[1.55] text-fg-muted">
            Synapse lets a language model act in your accounts. This page explains what decides
            whether it may, where your data lives, what gets recorded, and what Synapse does not
            protect you from.
          </p>
          <nav aria-label="On this page" className="landing-rise mt-8 flex flex-wrap gap-2">
            {[
              ["#containment", "Containment"],
              ["#permissions", "Permissions"],
              ["#data", "Your data"],
              ["#audit", "Audit"],
              ["#limits", "Limits"],
              ["#disclosure", "Report a vulnerability"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="inline-flex h-9 items-center rounded-full border border-ink/15 px-4 text-[14px] hover:border-ink/40"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>
      </section>

      <Section
        id="containment"
        eyebrow="Containment"
        title="Five checks between the model and the world."
        intro="The model only proposes. Code outside it decides, in this order, for every tool call. The model never sees or edits the policy, so nothing it reads can change it."
      >
        <Pipeline />
      </Section>

      <Section
        id="permissions"
        eyebrow="Permission model"
        title={
          <>
            Block wins. <span className="italic">Strictest wins.</span>
          </>
        }
        className="bg-lilac/60"
      >
        <Permissions />
      </Section>

      <Section id="data" eyebrow="Where data lives" title="On your machine, under your keys.">
        <DataWhere />
      </Section>

      <Section
        id="audit"
        eyebrow="Audit"
        title="A record of every decision."
        className="bg-sage/60"
      >
        <Audit />
      </Section>

      <section
        id="limits"
        aria-labelledby="limits-title"
        className="scroll-mt-24 bg-ink text-paper"
      >
        <div className="mx-auto max-w-[1120px] px-5 py-20 sm:px-8 lg:py-28">
          <Reveal className="max-w-[760px]">
            <Eyebrow>Honest limits</Eyebrow>
            <h2 id="limits-title" className={`mt-4 ${H2}`}>
              Approvals reduce risk. <span className="italic">They don't remove it.</span>
            </h2>
          </Reveal>
          <div className="mt-12">
            <Limits />
          </div>
        </div>
      </section>

      <Section
        id="disclosure"
        eyebrow="Responsible disclosure"
        title="Found a hole? Tell us privately."
        intro={
          <p>
            Please report security issues through GitHub's{" "}
            <a href={`${GITHUB}/security/advisories/new`}>private vulnerability reporting</a>, not a
            public issue. We aim to acknowledge reports within three working days. The threat model
            and mitigations are in <a href={`${GITHUB}/blob/main/SECURITY.md`}>SECURITY.md</a>.
          </p>
        }
      >
        <p className="flex items-center gap-2 text-[14px] text-fg-muted">
          <Lock className="size-4" aria-hidden="true" /> Synapse is MIT licensed: every line that
          touches your accounts is open to read.
        </p>
      </Section>
    </MarketingFrame>
  );
}
