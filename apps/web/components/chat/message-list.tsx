"use client";

import type { UiMessage, UiPart } from "@synapse/core/ui";
import type { ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import { ToolCard } from "./tool-card";

type ToolPart = Extract<UiPart, { type: "tool" }>;

export function MessageList({
  messages,
  streaming,
  queuedId,
  renderApproval,
}: {
  messages: UiMessage[];
  /** True while the run is active; the last reasoning part shows "Thinking…". */
  streaming: boolean;
  /** Id of a local user message that was queued into an active run. */
  queuedId: string | null;
  renderApproval: (part: ToolPart, message: UiMessage) => ReactNode;
}) {
  return (
    <ol className="space-y-5" aria-label="Messages">
      {messages.map((m, i) => (
        <li key={m.id}>
          {m.role === "user" ? (
            <UserMessage message={m} queued={m.id === queuedId} />
          ) : m.role === "handover" ? (
            <Handover message={m} />
          ) : (
            <AssistantMessage
              message={m}
              streaming={streaming && i === messages.length - 1}
              renderApproval={renderApproval}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function textOf(m: UiMessage) {
  return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

function UserMessage({ message, queued }: { message: UiMessage; queued: boolean }) {
  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 whitespace-pre-wrap break-words">
        {textOf(message)}
      </div>
      {queued ? (
        <p className="mt-1 text-xs text-fg-faint">
          Queued — the agent will read this at its next step.
        </p>
      ) : null}
    </div>
  );
}

function Handover({ message }: { message: UiMessage }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-xs text-fg-faint select-none [&::-webkit-details-marker]:hidden">
        <span className="h-px flex-1 bg-border" />
        <span className="group-hover:text-fg-muted">Earlier conversation summarized</span>
        <span className="h-px flex-1 bg-border" />
      </summary>
      <div className="mt-2 rounded-md bg-subtle p-3 text-fg-muted">
        <Markdown text={textOf(message)} />
      </div>
    </details>
  );
}

function AssistantMessage({
  message,
  streaming,
  renderApproval,
}: {
  message: UiMessage;
  streaming: boolean;
  renderApproval: (part: ToolPart, message: UiMessage) => ReactNode;
}) {
  if (message.parts.length === 0) {
    return streaming ? <p className="text-fg-faint animate-pulse-dot">Thinking…</p> : null;
  }
  return (
    <div className="space-y-2">
      {message.parts.map((part, i) => {
        const key = part.type === "tool" ? part.toolCallId : `${part.type}-${i}`;
        const last = i === message.parts.length - 1;
        if (part.type === "text") return <Markdown key={key} text={part.text} />;
        if (part.type === "reasoning") {
          return (
            <details key={key} className="group text-fg-muted">
              <summary className="cursor-pointer text-xs select-none hover:text-fg">
                {streaming && last ? "Thinking…" : "Reasoning"}
              </summary>
              <div className="mt-1 border-l-2 border-border pl-3 whitespace-pre-wrap">
                {part.text}
              </div>
            </details>
          );
        }
        if (part.status === "awaiting_approval") {
          return <div key={key}>{renderApproval(part, message)}</div>;
        }
        return <ToolCard key={key} part={part} />;
      })}
    </div>
  );
}
