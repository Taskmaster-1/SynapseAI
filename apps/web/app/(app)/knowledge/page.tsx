"use client";

import {
  Bot,
  FileText,
  LoaderCircle,
  Pencil,
  PenLine,
  RotateCw,
  Search,
  Trash,
  Upload,
  User,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type DragEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { EmptyState, ErrorNote, Page, PageHeader, Pill, Skeleton, Tabs } from "@/components/ui";
import { api, errorMessage, type Memory, type SearchResult } from "@/lib/api";
import { cx, formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import { useApi } from "@/lib/use-api";

type Tab = "documents" | "memory";

export default function KnowledgePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("documents");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "memory") setTab("memory");
  }, []);
  return (
    <Page>
      <PageHeader
        eyebrow="What it knows"
        title={
          <>
            Knowledge <span className="text-fg-muted italic">&amp; memory</span>
          </>
        }
        description="What the agent can look up and what it remembers about you."
      />
      <Tabs<Tab>
        label="Knowledge"
        className="mb-6"
        value={tab}
        onChange={(t) => {
          setTab(t);
          router.replace(t === "memory" ? "/knowledge?tab=memory" : "/knowledge");
        }}
        tabs={[
          { value: "documents", label: "Documents" },
          { value: "memory", label: "Memory" },
        ]}
      />
      {tab === "documents" ? <Documents /> : <MemoryTab />}
    </Page>
  );
}

// ---------- Documents ----------

const ACCEPT =
  ".txt,.md,.markdown,.csv,.json,.html,.htm,text/plain,text/markdown,text/csv,application/json,text/html";
const MAX_BYTES = 10 * 1024 * 1024;
const SETTLED = new Set(["ready", "indexed", "failed", "error"]);

function Documents() {
  const toast = useToast();
  const docs = useApi(() => api.documents());
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = docs.data?.documents;
  const pending = (list ?? []).some((d) => !SETTLED.has(d.status));

  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void docs.reload(), 3000);
    return () => clearInterval(t);
  }, [pending, docs.reload]);

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast(`${file.name} is larger than 10 MB`, "error");
        continue;
      }
      setUploading((n) => n + 1);
      try {
        await api.uploadDocument(file);
        toast(`Added ${file.name}`, "success");
      } catch (err) {
        toast(`${file.name}: ${errorMessage(err)}`, "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    void docs.reload();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  }

  return (
    <div className="space-y-8">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "flex w-full flex-col items-center justify-center rounded-[16px] border-[1.5px] border-dashed px-4 py-10 text-center transition-colors duration-150",
          dragging
            ? "border-accent bg-accent-soft"
            : "border-line-strong bg-surface/50 hover:border-fg-faint hover:bg-surface",
        )}
      >
        <span className="grid size-10 place-items-center rounded-full bg-fg text-canvas">
          {uploading > 0 ? <LoaderCircle className="anim-spin" /> : <Upload />}
        </span>
        <span className="mt-3.5 font-serif text-[22px] leading-tight text-fg">
          {uploading > 0 ? `Uploading ${uploading}…` : "Drop files here, or click to upload"}
        </span>
        <span className="mt-1 text-12 text-fg-muted">
          Text, Markdown, CSV, JSON or HTML · up to 10 MB
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="-mt-5 text-12 text-fg-faint">
        Documents count as outside content: once the agent reads one, anything that sends, changes
        or deletes needs your approval.
      </p>

      <SearchBox />

      <section>
        <h2 className="mb-4 flex items-baseline gap-2 border-b border-line pb-2.5 font-serif text-[24px] leading-none text-fg">
          Library
          {list ? (
            <span className="tabular font-sans text-13 text-fg-faint">{list.length}</span>
          ) : null}
        </h2>
        {docs.error ? <ErrorNote>{errorMessage(docs.error)}</ErrorNote> : null}
        {!list ? (
          <Skeleton className="h-16 rounded-card" />
        ) : list.length === 0 ? (
          <EmptyState compact illustration={<SampleDocuments />} title="The shelf is empty">
            Drop handbooks, policies or notes above and the agent can search them.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">
            {list.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-sunken text-fg-muted">
                  <FileText />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-14 text-fg">{d.name}</div>
                  <div className="text-12 text-fg-faint" title={formatDateTime(d.createdAt)}>
                    {formatBytes(d.bytes)} · {formatRelative(d.createdAt)}
                  </div>
                  {d.error ? <div className="text-12 text-danger">{d.error}</div> : null}
                </div>
                <DocStatus status={d.status} />
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label={`Delete ${d.name}`}
                  onClick={async () => {
                    if (!window.confirm(`Delete ${d.name}?`)) return;
                    try {
                      await api.deleteDocument(d.id);
                      docs.setData((x) =>
                        x ? { documents: x.documents.filter((y) => y.id !== d.id) } : x,
                      );
                    } catch (err) {
                      toast(errorMessage(err), "error");
                    }
                  }}
                >
                  <Trash className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DocStatus({ status }: { status: string }) {
  if (status === "ready" || status === "indexed") return <Pill tone="ok">Ready</Pill>;
  if (status === "failed" || status === "error") return <Pill tone="danger">Failed</Pill>;
  return (
    <Pill>
      <LoaderCircle className="anim-spin size-3" />
      Processing
    </Pill>
  );
}

function highlight(text: string, query: string): ReactNode {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return text;
  const re = new RegExp(`(${terms.join("|")})`, "gi");
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split positions are stable
      <mark key={i} className="rounded-[3px] bg-attention-soft px-0.5 text-fg">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function SearchBox() {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  async function search(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setBusy(true);
    setError(null);
    try {
      const res = await api.searchDocuments(query, ctrl.current.signal);
      setResults(res.results);
      setAsked(query);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="mb-4 border-b border-line pb-2.5 font-serif text-[24px] leading-none text-fg">
        Search <span className="text-fg-muted italic">like the agent would</span>
      </h2>
      <search>
        <form onSubmit={search} className="relative">
          <label htmlFor="kb-search" className="sr-only">
            Search documents
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-faint" />
          <input
            id="kb-search"
            className="input h-10 pr-24 pl-9"
            type="search"
            placeholder="e.g. refund policy"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-sm absolute top-1/2 right-1.5 -translate-y-1/2"
            disabled={busy || !q.trim()}
          >
            {busy ? "Searching…" : "Search"}
          </button>
        </form>
      </search>
      {error ? <ErrorNote className="mt-3">{error}</ErrorNote> : null}
      {results ? (
        results.length === 0 ? (
          <p className="mt-3 text-13 text-fg-muted">No passages match “{asked}”.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {results.map((r) => (
              <li
                key={`${r.documentId}-${r.position}`}
                className="rounded-[10px] border border-line bg-surface px-4 py-3"
              >
                <div className="mb-1.5 flex items-center gap-2 text-12 text-fg-faint">
                  <FileText className="size-3.5" />
                  <span className="truncate font-medium text-fg-muted">{r.document}</span>
                  <span className="tabular ml-auto">match {(r.score * 100).toFixed(0)}%</span>
                </div>
                <p className="line-clamp-4 text-13 whitespace-pre-wrap text-fg">
                  {highlight(r.content, asked)}
                </p>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </section>
  );
}

// ---------- Memory ----------

function MemoryTab() {
  const toast = useToast();
  const mems = useApi(() => api.memories());
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const all = mems.data?.memories;
  const style = all?.find((m) => m.source === "style") ?? null;
  const list = all?.filter((m) => m.source !== "style");

  async function add(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setBusy(true);
    try {
      const { memory } = await api.addMemory(content);
      mems.setData((d) => ({ memories: [memory, ...(d?.memories ?? [])] }));
      setDraft("");
      toast("Note saved", "success");
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
    <div className="space-y-8">
      {all ? (
        <WritingStyle
          memory={style}
          onLearned={(m) =>
            mems.setData((d) => ({
              memories: [...(d?.memories ?? []).filter((x) => x.id !== m.id), m],
            }))
          }
          onSaved={replace}
          onDeleted={() => style && drop(style.id)}
        />
      ) : null}
      <p className="text-14 text-fg-muted">
        Notes the agent reads at the start of every task. It can add its own — review them here.
      </p>
      <form onSubmit={add} className="slip p-3.5">
        <label htmlFor="mem-new" className="sr-only">
          New note
        </label>
        <textarea
          id="mem-new"
          className="block min-h-16 w-full resize-none bg-transparent px-1 text-14 text-fg outline-none placeholder:text-fg-faint"
          placeholder="Something the agent should always know, e.g. “I prefer short replies.”"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add(e as unknown as FormEvent);
          }}
        />
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !draft.trim()}>
            Add note
          </button>
        </div>
      </form>

      {mems.error ? <ErrorNote>{errorMessage(mems.error)}</ErrorNote> : null}
      {!list ? (
        <Skeleton className="h-24 rounded-card" />
      ) : list.length === 0 ? (
        <EmptyState compact illustration={<SampleNote />} title="No notes yet">
          Write above what you'd tell a new assistant on day one.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">
          {list.map((m) => (
            <li key={m.id}>
              <MemoryItem memory={m} onSaved={replace} onDeleted={() => drop(m.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
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
    if (
      !window.confirm(
        m.source === "style"
          ? "Delete your writing style? Drafts go back to a neutral voice."
          : "Delete this note?",
      )
    )
      return;
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
    <div className="group flex gap-3 px-4 py-3.5">
      {m.source !== "style" ? (
        <span
          className={cx(
            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
            m.source === "agent" ? "bg-accent-soft text-accent" : "bg-sunken text-fg-muted",
          )}
          title={m.source === "agent" ? "Added by the agent" : "Added by you"}
        >
          {m.source === "agent" ? <Bot className="size-3.5" /> : <User className="size-3.5" />}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <label htmlFor={`mem-${m.id}`} className="sr-only">
              Edit note
            </label>
            <textarea
              id={`mem-${m.id}`}
              // biome-ignore lint/a11y/noAutofocus: the user just asked to edit
              autoFocus
              className="input min-h-20 resize-y"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditing(false);
                  setText(m.content);
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={save}
                disabled={busy || !text.trim()}
              >
                Save
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
          <p className="text-14 whitespace-pre-wrap text-fg">{m.content}</p>
        )}
        {m.source !== "style" ? (
          <p className="mt-1 text-12 text-fg-faint" title={formatDateTime(m.createdAt)}>
            {m.source === "agent" ? "Agent" : "You"} · {formatRelative(m.createdAt)}
          </p>
        ) : null}
      </div>
      {!editing ? (
        <div className="flex shrink-0 items-start gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label="Edit note"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label="Delete note"
            onClick={remove}
            disabled={busy}
          >
            <Trash className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The writing-style profile: learned from sent mail on request, then an ordinary note the
 * user can read, edit, relearn or delete.
 */
function WritingStyle({
  memory,
  onLearned,
  onSaved,
  onDeleted,
}: {
  memory: Memory | null;
  onLearned: (m: Memory) => void;
  onSaved: (m: Memory) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const integ = useApi(() => api.integrations());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const google = integ.data?.google;
  const connected = google?.connection?.status === "active";

  async function learn() {
    setBusy(true);
    setError(null);
    try {
      const { memory: m, samples } = await api.learnWritingStyle();
      onLearned(m);
      toast(`Learned from ${samples} sent emails`, "success");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="style-h"
      className="overflow-hidden rounded-[16px] border border-line bg-surface"
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 pt-4 pb-3">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <PenLine className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <h2 id="style-h" className="text-14 font-medium text-fg">
            Writing style
          </h2>
          <p className="mt-0.5 text-13 text-fg-muted">
            {memory
              ? "Drafts are written in this voice. Learned from your sent mail; edit it freely."
              : "Learn how you write from your last 25 sent emails, so drafts sound like you. Only a short description is kept, never the emails."}
          </p>
        </div>
        {google && !connected ? (
          google.available ? (
            <Link href="/connections" className="btn btn-sm shrink-0 max-sm:ml-10">
              Connect Google
            </Link>
          ) : null
        ) : (
          <button
            type="button"
            className={cx("btn btn-sm shrink-0 max-sm:ml-10", !memory && "btn-primary")}
            disabled={busy || !connected}
            onClick={() => void learn()}
          >
            {busy ? (
              <LoaderCircle className="anim-spin size-3.5" />
            ) : memory ? (
              <RotateCw className="size-3.5" />
            ) : null}
            {busy ? "Reading sent mail…" : memory ? "Relearn" : "Learn my writing style"}
          </button>
        )}
      </div>
      {google && !google.available && !memory ? (
        <p className="border-t border-line px-4 py-3 text-13 text-fg-muted">
          Needs Google set up on this server. See docs/google.md.
        </p>
      ) : null}
      {error ? <ErrorNote className="mx-4 mb-4">{error}</ErrorNote> : null}
      {memory ? (
        <div className="border-t border-line bg-sunken/40">
          <MemoryItem memory={memory} onSaved={onSaved} onDeleted={onDeleted} />
        </div>
      ) : null}
    </section>
  );
}

// ---------- Empty-state art ----------

function SampleDocuments() {
  const docs = [
    { name: "handbook.md", r: -7, x: 0, y: 40, lines: [90, 70, 82, 60] },
    { name: "refunds.md", r: 5, x: 100, y: 0, lines: [80, 92, 55, 74] },
    { name: "q4-plan.md", r: -1.5, x: 50, y: 64, lines: [85, 64, 90, 48] },
  ];
  return (
    <div className="relative h-[190px] w-[260px]">
      {docs.map((d) => (
        <div
          key={d.name}
          className="slip absolute w-[150px] px-3.5 pt-3 pb-4"
          style={{ left: d.x, top: d.y, rotate: `${d.r}deg` }}
        >
          <p className="flex items-center gap-1.5 font-mono text-[9.5px] text-fg-muted">
            <FileText className="size-3" /> {d.name}
          </p>
          <div className="mt-2.5 space-y-1.5">
            {d.lines.map((w) => (
              <span
                key={`${d.name}-${w}`}
                className="block h-[5px] rounded-full bg-line"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SampleNote() {
  return (
    <div className="relative w-[240px] rotate-[-2.5deg]">
      <div
        className="slip relative overflow-hidden px-5 pt-4 pb-5"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent 0 25px, color-mix(in srgb, var(--accent) 16%, transparent) 25px 26px)",
          backgroundPosition: "0 14px",
        }}
      >
        <span className="absolute inset-y-0 left-3 w-px bg-danger/30" />
        <p className="pl-2 font-mono text-[9.5px] tracking-[0.12em] text-fg-faint uppercase">
          Note · You
        </p>
        <p className="mt-1.5 pl-2 font-serif text-[19px] leading-[26px] text-fg italic">
          Keep replies short. Sign emails as Ada. Never book before 10am.
        </p>
      </div>
      <span className="absolute -top-2 left-1/2 h-5 w-14 -translate-x-1/2 rotate-[3deg] bg-field-amber/50" />
    </div>
  );
}
