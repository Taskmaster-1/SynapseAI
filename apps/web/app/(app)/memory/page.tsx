"use client";

import { type FormEvent, useState } from "react";
import { Empty, ErrorNote, Page, Section, Spinner } from "@/components/page";
import { useToast } from "@/components/toast";
import { api, errorMessage, type Memory } from "@/lib/api";
import { cx, formatRelative } from "@/lib/format";
import { useApi } from "@/lib/use-api";

export default function MemoryPage() {
  const toast = useToast();
  const mems = useApi(() => api.memories());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const list = mems.data?.memories;

  async function add(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setBusy(true);
    try {
      const { memory } = await api.addMemory(content);
      mems.setData((d) => ({ memories: [memory, ...(d?.memories ?? [])] }));
      setDraft("");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  const replace = (m: Memory) =>
    mems.setData((d) => (d ? { memories: d.memories.map((x) => (x.id === m.id ? m : x)) } : d));
  const drop = (id: string) =>
    mems.setData((d) => (d ? { memories: d.memories.filter((x) => x.id !== id) } : d));

  return (
    <Page
      title="Memory"
      description="Notes the agent keeps about you and your work. It reads them at the start of every run. The agent can add notes too — review them here."
    >
      <Section title="Add a note">
        <form onSubmit={add} className="space-y-2">
          <label htmlFor="mem-new" className="sr-only">
            New note
          </label>
          <textarea
            id="mem-new"
            className="input min-h-20"
            placeholder="e.g. I prefer short replies. My team's Linear key is ENG."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
            {busy ? "Saving…" : "Add note"}
          </button>
        </form>
      </Section>

      {mems.error ? <ErrorNote error={errorMessage(mems.error)} /> : null}
      {!list ? (
        mems.loading ? (
          <Spinner />
        ) : null
      ) : list.length === 0 ? (
        <Empty>No notes yet.</Empty>
      ) : (
        <ul className="space-y-2">
          {list.map((m) => (
            <li key={m.id}>
              <MemoryItem memory={m} onSaved={replace} onDeleted={() => drop(m.id)} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

function MemoryItem({
  memory: m,
  onSaved,
  onDeleted,
}: {
  memory: Memory;
  onSaved: (m: Memory) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.content);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const { memory } = await api.updateMemory(m.id, text.trim());
      onSaved(memory);
      setEditing(false);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this note?")) return;
    setBusy(true);
    try {
      await api.deleteMemory(m.id);
      onDeleted();
    } catch (err) {
      toast(errorMessage(err), "error");
      setBusy(false);
    }
  }

  return (
    <div className="card p-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-fg-faint">
        <span
          className={cx(
            "inline-flex h-5 items-center rounded px-1.5 font-medium",
            m.source === "agent" ? "bg-accent-soft text-accent" : "bg-read-bg text-read-fg",
          )}
        >
          {m.source === "agent" ? "Agent" : "You"}
        </span>
        <span>{formatRelative(m.createdAt)}</span>
        <span className="ml-auto flex gap-1">
          {editing ? null : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm text-danger-fg"
            onClick={remove}
            disabled={busy}
          >
            Delete
          </button>
        </span>
      </div>
      {editing ? (
        <div className="space-y-2">
          <label htmlFor={`mem-${m.id}`} className="sr-only">
            Edit note
          </label>
          <textarea
            id={`mem-${m.id}`}
            className="input min-h-20"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={save}
              disabled={busy || !text.trim()}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setEditing(false);
                setText(m.content);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap">{m.content}</p>
      )}
    </div>
  );
}
