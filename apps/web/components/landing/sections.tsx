import {
  CalendarClock,
  Check,
  Database,
  FileDown,
  Inbox,
  KeyRound,
  ListChecks,
  Mail,
  MessageSquare,
  Monitor,
  ShieldCheck,
  Smartphone,
  Undo2,
  Users,
  Wallet,
  Webhook,
} from "lucide-react";
import type { ReactNode } from "react";
import { Monogram } from "@/components/ui";
import { HackDemo } from "./hack-demo";
import { Reveal } from "./reveal";

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`font-mono text-[12px] tracking-[0.14em] uppercase opacity-70 ${className ?? ""}`}
    >
      {children}
    </p>
  );
}

const H2 = "font-serif text-[clamp(44px,5.6vw,84px)] leading-[0.95] tracking-[-0.025em]";

// ── Try to hack it ───────────────────────────────────────────────────────────

export function HackSection() {
  return (
    <section id="hack" className="landing-sheet z-20 scroll-mt-20 bg-paper">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 lg:py-32">
        <Reveal className="max-w-[820px]">
          <Eyebrow>Prompt injection, live</Eyebrow>
          <h2 className={`mt-4 ${H2}`}>
            Try to <span className="text-accent italic">hack it.</span>
          </h2>
          <p className="mt-6 max-w-[620px] text-[18px] leading-[1.55] text-fg-muted">
            Write the nastiest email you can. Assume the model falls for it. Synapse still decides
            what runs in code, not in the prompt: once a task has read outside content, nothing that
            writes, sends or deletes runs without you.
          </p>
          <p className="mt-4 font-serif text-[clamp(22px,2.2vw,28px)] leading-snug italic">
            The model can be fooled. The policy can't be talked out of asking.
          </p>
        </Reveal>
        <div className="mt-12">
          <HackDemo />
        </div>
      </div>
    </section>
  );
}

// ── Asks less over time ──────────────────────────────────────────────────────

function LearnedRuleCard() {
  return (
    <div className="landing-slip p-5 text-[14px]">
      <p className="text-fg-muted">You approved 7 emails to @acme.com without changes.</p>
      <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-dashed border-line-strong px-3 py-2.5">
        <Monogram name="gmail" size={18} />
        <span className="min-w-0 flex-1">
          Allow emails where every address is <b className="font-medium">@acme.com</b>
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <span className="inline-flex h-8 items-center rounded-full bg-ink px-3.5 text-[13px] font-medium text-paper">
          Add rule
        </span>
        <span className="inline-flex h-8 items-center rounded-full border border-line-strong px-3.5 text-[13px]">
          Not now
        </span>
      </div>
    </div>
  );
}

function PlanCard() {
  const items: [string, boolean][] = [
    ["Reply to Bob: “3pm works”", true],
    ["Move Thursday's sync to 3pm", true],
    ["Email the team about the change", false],
  ];
  return (
    <div className="landing-slip p-5 text-[14px]">
      <p className="font-medium">The plan</p>
      <ul className="mt-3 space-y-2">
        {items.map(([t, on]) => (
          <li key={t} className="flex items-center gap-2.5">
            <span
              className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border ${on ? "border-ink bg-ink text-paper" : "border-line-strong"}`}
            >
              {on && <Check className="size-3" strokeWidth={3} />}
            </span>
            <span className={on ? undefined : "text-fg-faint line-through"}>{t}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-fg-muted">Approve 2 steps once. They run as written.</p>
    </div>
  );
}

function UndoCard() {
  return (
    <div className="landing-slip overflow-hidden text-[14px]">
      <div className="flex items-center gap-2 px-5 pt-5">
        <span className="font-medium">Sending in 7s</span>
        <span className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-[13px] font-medium">
          <Undo2 className="size-3.5" /> Undo
        </span>
      </div>
      <p className="px-5 pt-1 text-fg-muted">Email bob@acme.com: Re: Sync tomorrow?</p>
      <div className="mx-5 mt-4 mb-5 h-[3px] overflow-hidden rounded-full bg-sunken">
        <div className="h-full w-[70%] bg-attention" />
      </div>
    </div>
  );
}

const GROWS = [
  {
    title: "Learned rules",
    body: "Approve the same kind of action unchanged a few times and Synapse offers a rule for it. You see it, you accept it, you can delete it. It never adds one on its own.",
    card: <LearnedRuleCard />,
  },
  {
    title: "Approve a plan once",
    body: "For bigger jobs the agent lists the exact actions it will take. Untick what you don't want; the rest runs without asking again, exactly as you saw it.",
    card: <PlanCard />,
  },
  {
    title: "Ten seconds to undo",
    body: "Approved sends and deletes wait a few seconds (10 by default, your choice) with an Undo button. Tap too fast? Take it back.",
    card: <UndoCard />,
  },
];

export function AsksLess() {
  return (
    <section id="features" className="landing-sheet z-[22] scroll-mt-20 bg-lilac text-ink">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 lg:py-32">
        <Reveal className="max-w-[820px]">
          <Eyebrow>Autonomy that grows</Eyebrow>
          <h2 className={`mt-4 ${H2}`}>
            Asks smartly. <span className="italic">Less every week.</span>
          </h2>
          <p className="mt-6 max-w-[600px] text-[18px] leading-[1.55] opacity-75">
            An agent that asks about everything gets ignored. Synapse starts careful and earns room
            as you show it what's fine. Anything that read outside content still asks.
          </p>
        </Reveal>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {GROWS.map((g, i) => (
            <Reveal key={g.title} delay={i * 110} className="flex flex-col">
              <div className="flex-1">{g.card}</div>
              <h3 className="mt-6 font-serif text-[30px] leading-tight">{g.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed opacity-75">{g.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Approve anywhere ─────────────────────────────────────────────────────────

const CHANNELS = [
  {
    icon: Smartphone,
    title: "Your phone",
    body: "Install it as an app. Approve or Deny right on the lock screen; the undo window still applies.",
  },
  {
    icon: MessageSquare,
    title: "Slack",
    body: "A DM with Approve and Deny buttons. The message updates wherever you decide.",
  },
  {
    icon: Mail,
    title: "Email",
    body: "Opt-in alerts with a link straight to the waiting task.",
  },
  {
    icon: Monitor,
    title: "The app",
    body: "One inbox for everything waiting. Edit the draft first, or deny with a reason the agent reads.",
  },
];

export function ApproveAnywhere() {
  return (
    <section className="landing-sheet z-[24] bg-paper">
      <div className="mx-auto grid max-w-[1280px] gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-32">
        <Reveal>
          <Eyebrow>Approve anywhere</Eyebrow>
          <h2 className={`mt-4 ${H2}`}>
            Wherever you are, <span className="text-accent italic">one tap.</span>
          </h2>
          <p className="mt-6 max-w-[460px] text-[18px] leading-[1.55] text-fg-muted">
            A paused task waits in Postgres, not in a browser tab. Decide from whichever device is
            closest; every channel sees the same decision.
          </p>
        </Reveal>
        <ul className="grid gap-4 sm:grid-cols-2">
          {CHANNELS.map((c, i) => (
            <Reveal as="li" key={c.title} delay={i * 90}>
              <div className="h-full rounded-[18px] border border-ink/10 bg-surface p-6">
                <c.icon className="size-6" strokeWidth={1.6} />
                <h3 className="mt-5 text-[18px] font-semibold tracking-[-0.01em]">{c.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-fg-muted">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Automations ──────────────────────────────────────────────────────────────

const TRIGGERS = [
  {
    icon: CalendarClock,
    when: "On a schedule",
    example: "Every weekday at 8:30, brief me on unread email and today's meetings.",
  },
  {
    icon: Inbox,
    when: "When an email arrives",
    example: "When an invoice arrives from a supplier, file it and draft a thank-you.",
  },
  {
    icon: Webhook,
    when: "From a webhook",
    example: "When GitHub reports a new bug, look into it and draft a reply.",
  },
];

export function Automations() {
  return (
    <section className="landing-sheet z-[34] bg-sage text-ink">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 lg:py-32">
        <Reveal className="max-w-[820px]">
          <Eyebrow>Automations</Eyebrow>
          <h2 className={`mt-4 ${H2}`}>
            Works while <span className="italic">you don't.</span>
          </h2>
          <p className="mt-6 max-w-[600px] text-[18px] leading-[1.55] opacity-75">
            Start work on a schedule, on new email that matches a search, or when another app calls
            a secret webhook URL. Each event becomes its own task, starts tainted, and only reaches
            you when it needs a signature.
          </p>
        </Reveal>
        <ul className="mt-14 grid gap-5 md:grid-cols-3">
          {TRIGGERS.map((t, i) => (
            <Reveal as="li" key={t.when} delay={i * 110}>
              <div className="h-full rounded-[18px] bg-paper/80 p-6 shadow-[var(--slip-shadow)]">
                <span className="flex items-center gap-2 font-mono text-[12px] tracking-[0.1em] uppercase">
                  <t.icon className="size-4" /> {t.when}
                </span>
                <p className="mt-5 font-serif text-[24px] leading-[1.25]">“{t.example}”</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Teams and budgets ────────────────────────────────────────────────────────

const TEAM = [
  {
    icon: ShieldCheck,
    title: "Strictest rule wins",
    body: "Team rules apply on top of everyone's own. A team block can't be overridden, and a team allow never loosens a member's ask.",
  },
  {
    icon: KeyRound,
    title: "Admin sign-off",
    body: "Route risky actions to an admin instead of the person whose task asked. Push, email and Slack go to the admins.",
  },
  {
    icon: Users,
    title: "Invite links",
    body: "One-time links that expire in 7 days and can be revoked. Tasks, connections and memory stay personal.",
  },
  {
    icon: FileDown,
    title: "Audit export",
    body: "A CSV of every proposed action: who, what, what the rules said, who decided, and from where.",
  },
  {
    icon: Wallet,
    title: "Per-task budgets",
    body: "Step, token and dollar caps per task, plus a daily dollar cap, checked before every model call. Users can only tighten the operator's caps.",
  },
  {
    icon: Database,
    title: "Crash-safe runs",
    body: "Runs are checkpointed in Postgres. An action interrupted mid-flight is reported as unknown, never silently retried.",
  },
];

export function Teams() {
  return (
    <section className="landing-sheet z-[36] bg-paper">
      <div className="mx-auto max-w-[1280px] px-5 py-24 sm:px-8 lg:py-32">
        <Reveal className="max-w-[820px]">
          <Eyebrow>Teams and guardrails</Eyebrow>
          <h2 className={`mt-4 ${H2}`}>
            One set of rules. <span className="text-accent italic">Everyone under it.</span>
          </h2>
        </Reveal>
        <ul className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {TEAM.map((t, i) => (
            <Reveal as="li" key={t.title} delay={(i % 3) * 90}>
              <div className="border-t border-ink/15 pt-5">
                <t.icon className="size-5" strokeWidth={1.7} />
                <h3 className="mt-4 text-[18px] font-semibold tracking-[-0.01em]">{t.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-fg-muted">{t.body}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Why Synapse ──────────────────────────────────────────────────────────────

const QUESTIONS: [string, string][] = [
  [
    "Where do the approval rules live?",
    "In code, outside the model. The model never sees or edits them, so no email can argue them away.",
  ],
  [
    "What happens after it reads something untrusted?",
    "The task is tainted. From then on, nothing that writes, sends or deletes runs without you, whatever your rules say.",
  ],
  [
    "Does it ask about everything forever?",
    "No. Learned rules and approved plans cut the asking down, and you can see and delete every rule.",
  ],
  [
    "Can you take back an approval?",
    "Yes. Approved sends and deletes wait a few seconds with Undo.",
  ],
  [
    "Can you see exactly what it did?",
    "Every run, tool call, decision, who decided, tokens and cost, in the activity log.",
  ],
  [
    "Who holds your data and keys?",
    "You do. Self-hosted on your Postgres, with your model keys. MIT licensed.",
  ],
];

export function WhySynapse() {
  return (
    <section className="landing-sheet z-[38] bg-field-amber text-ink">
      <div className="mx-auto grid max-w-[1280px] gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:py-32">
        <Reveal>
          <Eyebrow>Why Synapse</Eyebrow>
          <h2 className={`mt-4 ${H2}`}>
            Questions to ask <span className="italic">any agent.</span>
          </h2>
          <p className="mt-6 max-w-[400px] text-[18px] leading-[1.55] opacity-75">
            Plenty of agents pause before acting now. Ask what happens around the pause.
          </p>
        </Reveal>
        <dl className="divide-y divide-ink/20 border-y border-ink/20">
          {QUESTIONS.map(([q, a], i) => (
            <Reveal key={q} delay={i * 60}>
              <div className="grid gap-2 py-5 sm:grid-cols-[0.9fr_1.1fr] sm:gap-8">
                <dt className="font-serif text-[22px] leading-snug">{q}</dt>
                <dd className="text-[15px] leading-relaxed opacity-80">
                  <ListChecks className="mr-1.5 inline size-4 -translate-y-px" />
                  {a}
                </dd>
              </div>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}
