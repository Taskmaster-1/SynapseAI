"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { hostOf } from "@/lib/format";

/**
 * Agent output can carry prompt-injected content, so:
 * - raw HTML is dropped (skipHtml),
 * - remote images are never fetched (they'd leak data via the URL) — we show a link instead,
 * - links open in a new tab without referrer and display their real destination host.
 */
const components: Components = {
  img({ src, alt }) {
    const url = typeof src === "string" ? src : undefined;
    const host = hostOf(url);
    const label = alt ? `Image: ${alt}` : "Image";
    if (!url || !host) return <span className="text-fg-muted">[{label}]</span>;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" title={url}>
        [{label}] <span className="text-fg-faint no-underline">({host})</span>
      </a>
    );
  },
  a({ href, children }) {
    const host = hostOf(href);
    if (!href || !host) return <span>{children}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" title={href}>
        {children}
        <span className="ml-1 text-[0.857em] text-fg-faint" style={{ textDecoration: "none" }}>
          ({host})
        </span>
      </a>
    );
  },
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
