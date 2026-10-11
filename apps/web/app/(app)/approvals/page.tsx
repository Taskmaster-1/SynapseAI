"use client";

import Link from "next/link";
import { ApprovalCard } from "@/components/approval-card";
import { Empty, ErrorNote, Page, Spinner } from "@/components/page";
import { api, errorMessage } from "@/lib/api";
import { useChats } from "@/lib/chats-context";
import { formatRelative } from "@/lib/format";
import { useApi } from "@/lib/use-api";

export default function ApprovalsPage() {
  const { data, error, loading, reload, setData } = useApi(() => api.approvals());
  const { reload: reloadChats } = useChats();
  const approvals = data?.approvals;

  return (
    <Page
      title="Approvals"
      description="Actions the agent wants to take that your policy says need a human. Review the full input — edit it if needed — then approve or deny."
      actions={
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => void reload()}
          disabled={loading}
        >
          Refresh
        </button>
      }
    >
      {error ? <ErrorNote error={errorMessage(error)} /> : null}
      {!approvals ? (
        loading ? (
          <Spinner />
        ) : null
      ) : approvals.length === 0 ? (
        <Empty>Nothing waiting on you.</Empty>
      ) : (
        <ul className="space-y-4">
          {approvals.map((a) => (
            <li key={a.toolCallId}>
              <ApprovalCard
                runId={a.runId}
                toolCallId={a.toolCallId}
                name={a.name}
                effect={a.effect}
                input={a.input}
                reason={a.reason}
                header={
                  <span className="flex items-center gap-2 text-xs text-fg-muted">
                    <Link
                      href={`/c/${a.chatId}`}
                      className="max-w-48 truncate text-accent hover:underline"
                    >
                      {a.chatTitle || "Open chat"}
                    </Link>
                    <span>{formatRelative(a.createdAt)}</span>
                  </span>
                }
                onDecided={() => {
                  setData((d) =>
                    d ? { approvals: d.approvals.filter((x) => x.toolCallId !== a.toolCallId) } : d,
                  );
                  void reloadChats();
                }}
                onConflict={() => void reload()}
              />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
