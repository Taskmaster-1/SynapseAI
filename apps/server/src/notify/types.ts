import type { Effect } from "@synapse/core";
import type { JSONValue } from "ai";

/**
 * Why channels are told about an approval:
 * - `new`: it just started waiting;
 * - `reminder`: nobody decided yet (sent once);
 * - `escalated`: nobody decided, so the requester's team admins may decide it now;
 * - `second`: two-person sign-off, one person approved and it needs another.
 */
export type NoticeKind = "new" | "reminder" | "escalated" | "second";

/** One action waiting for a person, as notification channels see it. */
export interface PendingApproval {
  kind: NoticeKind;
  /** Whose task it is. */
  userId: string;
  /**
   * Who should hear about it: the requester today; team admins when a team rule says an
   * admin must sign off. Channels deliver to these people, not to `userId`.
   */
  recipients: string[];
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
  /** Plain-language risk facts, e.g. "Sends to 2 people outside acme.com" (at most 3). */
  facts: string[];
  /** It is denied as expired if nobody decides by then. */
  expiresAt: Date | null;
  /** Escalated to the requester's team admins. */
  escalated: boolean;
  /** Two-person sign-off: how many approvals it needs, and the first one if given. */
  signoffs: { needed: 1 | 2; first: { id: string; name: string } | null };
  createdAt: Date;
  /** Where to open it in the web app. */
  url: string;
}

/** What happened to an action, so channels can update what they showed (e.g. a Slack message). */
export interface ResolvedApproval {
  /** Whose task it is. */
  userId: string;
  /** Who decided: the requester, or a team admin for calls a team rule reserves for one. */
  decidedBy?: string;
  runId: string;
  toolCallId: string;
  approved: boolean;
  /** Where the decision was made. */
  via: DecisionSource;
  /** Set when a send or delete waits out its undo window. */
  executeAfter: Date | null;
  /** Two-person sign-off: the first of two approvals; it still waits for another person. */
  partial?: boolean;
}

/** Where a decision was made; `expiry` is nobody deciding in time. */
export type DecisionSource = "web" | "push" | "slack" | "email" | "expiry";

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
