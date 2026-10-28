"use client";

import type { Attachment } from "@synapse/core/ui";
import {
  FileArchive,
  FileAudio,
  File as FileIcon,
  FileText,
  FileVideo,
  LoaderCircle,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ChatFile, errorMessage } from "@/lib/api";
import { cx, formatBytes } from "@/lib/format";

/** Gmail's limit for one email, and so the most one attachment can usefully be. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const fileUrl = (id: string) => `/api/files/${encodeURIComponent(id)}/content`;

function Glyph({
  mimeType,
  name,
  className,
}: {
  mimeType: string;
  name: string;
  className?: string;
}) {
  const Icon = mimeType.startsWith("video/")
    ? FileVideo
    : mimeType.startsWith("audio/")
      ? FileAudio
      : /zip|compressed|tar|rar|7z/.test(mimeType) || /\.(zip|rar|7z|tgz|gz)$/i.test(name)
        ? FileArchive
        : mimeType.startsWith("text/") ||
            mimeType === "application/pdf" ||
            /\.(pdf|md|txt|csv|json)$/i.test(name)
          ? FileText
          : FileIcon;
  return <Icon className={className} aria-hidden />;
}

/** One attached file: a thumbnail for photos, an icon for everything else. */
export function FileChip({
  file,
  status = "ready",
  error,
  previewUrl,
  onRemove,
  href,
}: {
  file: { name: string; mimeType: string; bytes: number };
  status?: "uploading" | "ready" | "error";
  error?: string;
  /** Local object URL while uploading, or the stored file once it's saved. */
  previewUrl?: string | null;
  onRemove?: () => void;
  href?: string;
}) {
  const image = file.mimeType.startsWith("image/") && previewUrl;
  const body = (
    <>
      <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-sunken text-fg-muted">
        {image ? (
          // biome-ignore lint/performance/noImgElement: user files from our own API or a blob URL
          <img src={previewUrl} alt="" className="size-full object-cover" />
        ) : (
          <Glyph mimeType={file.mimeType} name={file.name} className="size-4" />
        )}
        {status === "uploading" ? (
          <span className="absolute inset-0 grid place-items-center bg-surface/70">
            <LoaderCircle className="anim-spin size-4 text-fg" />
          </span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-13 font-medium text-fg">{file.name}</span>
        <span
          className={cx(
            "block truncate text-12",
            status === "error" ? "text-danger" : "text-fg-faint",
          )}
        >
          {status === "error" ? (
            <>
              <TriangleAlert className="mr-1 inline size-3 align-[-2px]" />
              {error ?? "Upload failed"}
            </>
          ) : status === "uploading" ? (
            "Uploading…"
          ) : (
            formatBytes(file.bytes)
          )}
        </span>
      </span>
    </>
  );
  return (
    <span
      className={cx(
        "group relative inline-flex w-[220px] max-w-full items-center gap-2.5 rounded-[10px] border bg-surface py-1.5 pr-2 pl-1.5",
        status === "error" ? "border-danger/40" : "border-line",
      )}
    >
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-fg/30"
          title={`Open ${file.name}`}
        >
          {body}
        </a>
      ) : (
        body
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="grid size-6 shrink-0 place-items-center rounded-full text-fg-faint transition-colors hover:bg-hover hover:text-fg"
          aria-label={`Remove ${file.name}`}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}

export interface PendingFile {
  key: string;
  name: string;
  mimeType: string;
  bytes: number;
  status: "uploading" | "ready" | "error";
  error?: string;
  previewUrl: string | null;
  saved?: ChatFile;
}

/** Uploads files as soon as they're picked, so sending never waits on a big video. */
export function useAttachments() {
  const [items, setItems] = useState<PendingFile[]>([]);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const live = urls.current;
    return () => {
      for (const u of live) URL.revokeObjectURL(u);
    };
  }, []);

  const update = useCallback((key: string, patch: Partial<PendingFile>) => {
    setItems((all) => all.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }, []);

  const add = useCallback(
    (files: Iterable<File>) => {
      for (const file of files) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
        if (previewUrl) urls.current.add(previewUrl);
        const tooBig = file.size > MAX_FILE_BYTES;
        const empty = file.size === 0;
        setItems((all) => [
          ...all,
          {
            key,
            name: file.name || "file",
            mimeType: file.type || "application/octet-stream",
            bytes: file.size,
            status: tooBig || empty ? "error" : "uploading",
            ...(tooBig ? { error: "Over 25 MB" } : empty ? { error: "Empty file" } : {}),
            previewUrl,
          },
        ]);
        if (tooBig || empty) continue;
        api
          .uploadFile(file)
          .then(({ file: saved }) => update(key, { status: "ready", saved }))
          .catch((err) => update(key, { status: "error", error: errorMessage(err) }));
      }
    },
    [update],
  );

  const remove = useCallback((key: string) => {
    setItems((all) => {
      const gone = all.find((f) => f.key === key);
      if (gone?.previewUrl) {
        URL.revokeObjectURL(gone.previewUrl);
        urls.current.delete(gone.previewUrl);
      }
      if (gone?.saved) void api.deleteFile(gone.saved.id).catch(() => {});
      return all.filter((f) => f.key !== key);
    });
  }, []);

  /** Forget the list after sending; the files themselves stay with the message. */
  const clear = useCallback(() => setItems([]), []);

  const ready: Attachment[] = items.flatMap((f) =>
    f.saved
      ? [
          {
            fileId: f.saved.id,
            name: f.saved.name,
            mimeType: f.saved.mimeType,
            bytes: f.saved.bytes,
          },
        ]
      : [],
  );
  const uploading = items.some((f) => f.status === "uploading");
  return { items, add, remove, clear, ready, uploading, restore: setItems };
}

/** Files on a message you sent. */
export function MessageFiles({ files }: { files: Attachment[] }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {files.map((f) => (
        <FileChip
          key={f.fileId}
          file={f}
          href={fileUrl(f.fileId)}
          previewUrl={f.mimeType.startsWith("image/") ? fileUrl(f.fileId) : null}
        />
      ))}
    </div>
  );
}

/** Attachments on an email waiting for approval, looked up by id so you see what goes out. */
export function EmailAttachments({ ids }: { ids: string[] }) {
  const [files, setFiles] = useState<Record<string, ChatFile | "missing">>({});
  const key = ids.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: ids are captured by `key`
  useEffect(() => {
    let live = true;
    for (const id of ids) {
      api
        .file(id)
        .then(({ file }) => live && setFiles((f) => ({ ...f, [id]: file })))
        .catch(() => live && setFiles((f) => ({ ...f, [id]: "missing" })));
    }
    return () => {
      live = false;
    };
  }, [key]);
  return (
    <div className="flex flex-wrap gap-2">
      {ids.map((id) => {
        const f = files[id];
        if (f === "missing")
          return (
            <FileChip
              key={id}
              file={{ name: id, mimeType: "application/octet-stream", bytes: 0 }}
              status="error"
              error="Not one of your files"
            />
          );
        if (!f)
          return (
            <FileChip
              key={id}
              file={{ name: "Loading…", mimeType: "application/octet-stream", bytes: 0 }}
              status="uploading"
            />
          );
        return (
          <FileChip
            key={id}
            file={f}
            href={fileUrl(id)}
            previewUrl={f.mimeType.startsWith("image/") ? fileUrl(id) : null}
          />
        );
      })}
    </div>
  );
}
