import type { Effect } from "@synapse/core";
import type { JSONValue } from "ai";

/** One action waiting for a person, as notification channels see it. */
export interface PendingApproval {
  userId: string;
  runId: string;
  chatId: string;
  chatTitle: string | null;
  toolCallId: string;
  name: string;
  effect: Effect;
  /** One line from the tool, e.g. "Email bob@acme.com: Re: Sync". */
  preview: string | null;
  input: JSONValue;
  /** Why the policy asked. */
  reason: string | null;
  /** The task had read outside content when this was proposed. */
  tainted: boolean;
  createdAt: Date;
  /** Where to open it in the web app. */
  url: string;
}

/** What happened to an action, so channels can update what they showed (e.g. a Slack message). */
export interface ResolvedApproval {
  userId: string;
  runId: string;
  toolCallId: string;
  approved: boolean;
  /** Where the decision was made. */
  via: DecisionSource;
  /** Set when a send or delete waits out its undo window. */
  executeAfter: Date | null;
}

export type DecisionSource = "web" | "push" | "slack" | "email";

/**
 * A way to reach a person about approvals: web push, Slack, email. Channels decide for
 * themselves whether a user has them set up; `notify` is called for every new approval.
 * Failures are logged and never block the run or other channels.
 */
export interface NotificationChannel {
  readonly name: string;
  notify(approvals: PendingApproval[]): Promise<void>;
  /** Optional: the approvals were decided (anywhere). */
  resolved?(decided: ResolvedApproval[]): Promise<void>;
}
