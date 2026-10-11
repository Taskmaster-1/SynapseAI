"use client";

import { type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { Empty, ErrorNote, Page, Section, Spinner } from "@/components/page";
import { useToast } from "@/components/toast";
import { api, errorMessage, type SearchResult } from "@/lib/api";
import { cx, formatBytes, formatRelative } from "@/lib/format";
import { useApi } from "@/lib/use-api";

const ACCEPT =
  ".txt,.md,.markdown,.csv,.json,.html,.htm,text/plain,text/markdown,text/csv,application/json,text/html";
const MAX_BYTES = 10 * 1024 * 1024;
const SETTLED = new Set(["ready", "indexed", "failed", "error"]);

export default function KnowledgePage() {
  const toast = useToast();
  const docs = useApi(() => api.documents());
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = docs.data?.documents;
  const pending = (list ?? []).some((d) => !SETTLED.has(d.status));

  // Poll while documents are still being processed.
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
        toast(`Uploaded ${file.name}`, "success");
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
    <Page
      title="Knowledge"
      description="Documents the agent can search. Uploaded content is treated as untrusted: reading it taints the run, so outward actions afterwards need approval."
    >
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
          "mb-6 flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
          dragging ? "border-accent bg-accent-soft" : "border-border-strong hover:bg-hover",
        )}
      >
        <span className="font-medium">
          {uploading > 0 ? `Uploading ${uploading}…` : "Drop files here or click to upload"}
        </span>
        <span className="mt-1 text-xs text-fg-muted">
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

      <SearchBox />

      <Section title="Documents">
        {docs.error ? <ErrorNote error={errorMessage(docs.error)} /> : null}
        {!list ? (
          docs.loading ? (
            <Spinner />
          ) : null
        ) : list.length === 0 ? (
          <Empty>No documents yet.</Empty>
        ) : (
          <ul className="-my-2 divide-y divide-border">
            {list.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.name}</div>
                  <div className="text-xs text-fg-faint">
                    {formatBytes(d.bytes)} · {d.mimeType} · {formatRelative(d.createdAt)}
                  </div>
                  {d.error ? <div className="text-xs text-danger-fg">{d.error}</div> : null}
                </div>
                <DocStatus status={d.status} />
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
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
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}

function DocStatus({ status }: { status: string }) {
  const tone =
    status === "ready" || status === "indexed"
      ? "bg-ok-bg text-ok-fg"
      : status === "failed" || status === "error"
        ? "bg-danger-bg text-danger-fg"
        : "bg-read-bg text-read-fg";
  return (
    <span className={cx("inline-flex h-5 items-center rounded px-1.5 text-xs font-medium", tone)}>
      {status}
    </span>
  );
}

function SearchBox() {
  const [q, setQ] = useState("");
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
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Search" description="Try what the agent would find.">
      <search>
        <form onSubmit={search} className="flex gap-2">
          <label htmlFor="kb-search" className="sr-only">
            Search documents
          </label>
          <input
            id="kb-search"
            className="input"
            type="search"
            placeholder="e.g. refund policy"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="btn" disabled={busy || !q.trim()}>
            {busy ? "Searching…" : "Search"}
          </button>
        </form>
      </search>
      {error ? <p className="mt-3 text-danger-fg">{error}</p> : null}
      {results ? (
        results.length === 0 ? (
          <p className="mt-3 text-fg-muted">No matches.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {results.map((r) => (
              <li key={`${r.documentId}-${r.position}`} className="rounded-md bg-subtle p-3">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs text-fg-faint">
                  <span className="truncate font-medium text-fg-muted">{r.document}</span>
                  <span>score {r.score.toFixed(3)}</span>
                </div>
                <p className="line-clamp-4 whitespace-pre-wrap">{r.content}</p>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </Section>
  );
}
