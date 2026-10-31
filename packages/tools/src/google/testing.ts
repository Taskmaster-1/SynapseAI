/**
 * An in-memory stand-in for the slice of Google's OAuth, Gmail, Calendar, Drive and People APIs the
 * integration uses. Pass `fake.fetch` as `GoogleAppConfig.fetch` in tests.
 */
export interface FakeMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  internalDate: number;
  labelIds: string[];
  messageId?: string;
  /** Raw RFC 2822 text for messages sent through the API. */
  raw?: string;
  attachments?: FakeAttachment[];
}

export interface FakeAttachment {
  filename: string;
  mimeType: string;
  data: Uint8Array | string;
  /** Overrides the size Gmail reports, to fake a huge file without allocating one. */
  size?: number;
  /** Small parts can come with their data inline instead of an attachmentId. */
  inline?: boolean;
}

export interface FakeSpreadsheet {
  id: string;
  title: string;
  sheets: { sheetId: number; title: string; rows: (string | number | boolean)[][] }[];
}

export interface FakeEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: { email: string; responseStatus?: string; self?: boolean }[];
  status?: string;
}

export interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** For Google Docs, Sheets and Slides: what the text (or CSV) export returns. */
  content: string | Uint8Array;
  modifiedTime?: string;
  owner?: string;
  trashed?: boolean;
}

export interface FakeContact {
  name: string;
  emails?: string[];
  phones?: string[];
}

/** The grant a connection made before Drive, Contacts and Sheets existed carries. */
export const LEGACY_GOOGLE_SCOPE =
  "openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events";

const ALL_SCOPES = [
  LEGACY_GOOGLE_SCOPE,
  ...[
    "drive.readonly",
    "drive.file",
    "contacts.readonly",
    "contacts.other.readonly",
    "spreadsheets",
  ].map((s) => `https://www.googleapis.com/auth/${s}`),
].join(" ");

/** A one-page PDF with a line of Helvetica text, built by hand. */
export function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  const rows = offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const EXPORT_TYPES: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

/** Splits a multipart body into its parts' content types and bodies. */
function multipart(body: string, contentType: string) {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
  if (!boundary) return null;
  return body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((p) => {
      const head = p.slice(0, p.indexOf("\r\n\r\n"));
      return {
        type: /content-type:\s*([^\r\n]+)/i.exec(head)?.[1] ?? "",
        body: p.slice(p.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, ""),
      };
    });
}

export function fakeGoogle(opts: { email?: string } = {}) {
  const state = {
    email: opts.email ?? "ada@example.com",
    messages: [] as FakeMessage[],
    drafts: [] as { id: string; raw: string; threadId?: string }[],
    /** Messages sent or drafted through the multipart upload endpoint. */
    uploads: 0,
    events: [] as FakeEvent[],
    labels: [
      { id: "INBOX", name: "INBOX" },
      { id: "UNREAD", name: "UNREAD" },
      { id: "STARRED", name: "STARRED" },
      { id: "Label_1", name: "Receipts" },
    ],
    /** Requests seen, as "METHOD path". */
    calls: [] as string[],
    /** Set to make the next refresh fail with invalid_grant. */
    revoked: false,
    tokenExchanges: 0,
    refreshes: 0,
    lastAuthCode: null as string | null,
    lastVerifier: null as string | null,
    grantedScope: ALL_SCOPES,
    /** The primary calendar's zone, as events.list reports it. */
    timeZone: "UTC",
    files: [] as FakeDriveFile[],
    /** Google Docs created through the upload endpoint: the name and the HTML sent. */
    createdDocs: [] as { id: string; name: string; mimeType: string; html: string }[],
    contacts: [] as FakeContact[],
    otherContacts: [] as FakeContact[],
    /** People API searches seen, as "contacts:<query>" or "other:<query>". */
    peopleQueries: [] as string[],
    spreadsheets: [] as FakeSpreadsheet[],
    /** Sheets value writes, with the input option each used. */
    sheetWrites: [] as { kind: "append" | "update"; range: string; valueInputOption: string }[],
  };
  let n = 0;
  const nextId = (p: string) => `${p}${++n}`;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const header = (name: string, value: string) => ({ name, value });
  const bytesOf = (d: Uint8Array | string) =>
    typeof d === "string" ? new TextEncoder().encode(d) : d;
  // Like Gmail, every fetch hands out new attachment ids; all of them stay valid.
  let fetches = 0;
  const asGmail = (m: FakeMessage) => {
    const headers = [
      header("From", m.from),
      header("To", m.to),
      header("Subject", m.subject),
      ...(m.messageId ? [header("Message-ID", m.messageId)] : []),
    ];
    const text = { data: Buffer.from(m.body).toString("base64url") };
    const fetch = ++fetches;
    return {
      id: m.id,
      threadId: m.threadId,
      labelIds: m.labelIds,
      snippet: m.body.slice(0, 80),
      internalDate: String(m.internalDate),
      payload: m.attachments?.length
        ? {
            mimeType: "multipart/mixed",
            headers,
            body: { size: 0 },
            parts: [
              { mimeType: "text/plain", filename: "", body: text },
              ...m.attachments.map((a, i) => {
                const data = bytesOf(a.data);
                const size = a.size ?? data.byteLength;
                return {
                  mimeType: a.mimeType,
                  filename: a.filename,
                  body: a.inline
                    ? { size, data: Buffer.from(data).toString("base64url") }
                    : { size, attachmentId: `att-${m.id}-${i}-${fetch}` },
                };
              }),
            ],
          }
        : { mimeType: "text/plain", headers, body: text },
    };
  };

  /** Gmail search, just enough of it: `in:sent`, `after:<sec>`, `from:x`, `-from:me`, free words. */
  const matches = (m: FakeMessage, q: string) =>
    q
      .split(/\s+/)
      .filter(Boolean)
      .every((term) => {
        if (term === "in:inbox") return m.labelIds.includes("INBOX");
        if (term === "in:sent") return m.labelIds.includes("SENT");
        if (term === "is:unread") return m.labelIds.includes("UNREAD");
        if (term === "-from:me") return !m.from.includes(state.email);
        if (term.startsWith("after:")) return m.internalDate / 1000 > Number(term.slice(6)) - 1;
        if (term.startsWith("from:")) return m.from.includes(term.slice(5));
        return `${m.subject} ${m.body}`.toLowerCase().includes(term.toLowerCase());
      });

  async function handle(url: URL, init: RequestInit): Promise<Response> {
    const method = init.method ?? "GET";
    const path = url.pathname;
    state.calls.push(`${method} ${url.host}${path}`);
    const body = typeof init.body === "string" ? init.body : init.body?.toString();

    if (url.host === "oauth2.googleapis.com" && path === "/token") {
      const p = new URLSearchParams(body);
      if (p.get("grant_type") === "authorization_code") {
        state.tokenExchanges++;
        state.lastAuthCode = p.get("code");
        state.lastVerifier = p.get("code_verifier");
        return json({
          access_token: "at-1",
          refresh_token: "rt-1",
          expires_in: 3600,
          scope: state.grantedScope,
        });
      }
      state.refreshes++;
      if (state.revoked)
        return json({ error: "invalid_grant", error_description: "Token has been revoked." }, 400);
      return json({ access_token: `at-r${state.refreshes}`, expires_in: 3600 });
    }
    if (url.host === "oauth2.googleapis.com" && path === "/revoke") return json({});
    if (url.host === "openidconnect.googleapis.com") return json({ email: state.email });

    // Multipart uploads (messages with attachments): JSON metadata, then the raw message.
    const upload = path.match(/^\/upload\/gmail\/v1\/users\/me\/(messages\/send|drafts)$/);
    if (upload) {
      const type = new Headers(init.headers).get("content-type") ?? "";
      const boundary = /boundary=([^;]+)/.exec(type)?.[1];
      if (url.searchParams.get("uploadType") !== "multipart" || !boundary || !body)
        return json({ error: { message: "bad upload" } }, 400);
      const parts = body
        .split(`--${boundary}`)
        .slice(1, -1)
        .map((p) => p.slice(p.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, ""));
      const meta = JSON.parse(parts[0]!) as {
        threadId?: string;
        message?: { threadId?: string };
      };
      const raw = parts[1]!;
      state.uploads++;
      if (upload[1] === "drafts") {
        const threadId = meta.message?.threadId;
        const d = { id: nextId("d"), raw, ...(threadId ? { threadId } : {}) };
        state.drafts.push(d);
        return json({ id: d.id });
      }
      const m: FakeMessage = {
        id: nextId("sent"),
        threadId: meta.threadId ?? nextId("t"),
        from: state.email,
        to: "",
        subject: "",
        body: "",
        internalDate: Date.now(),
        labelIds: ["SENT"],
        raw,
      };
      state.messages.push(m);
      return json({ id: m.id, threadId: m.threadId });
    }

    const gmail = path.match(/^\/gmail\/v1\/users\/me\/(.*)$/);
    if (gmail) {
      const rest = gmail[1]!;
      if (rest === "messages" && method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        const max = Number(url.searchParams.get("maxResults") ?? 100);
        const hits = state.messages
          .filter((m) => matches(m, q))
          .sort((a, b) => b.internalDate - a.internalDate)
          .slice(0, max);
        return json(
          hits.length ? { messages: hits.map((m) => ({ id: m.id, threadId: m.threadId })) } : {},
        );
      }
      if (rest === "messages/send") {
        const { raw, threadId } = JSON.parse(body!) as { raw: string; threadId?: string };
        const m: FakeMessage = {
          id: nextId("sent"),
          threadId: threadId ?? nextId("t"),
          from: state.email,
          to: "",
          subject: "",
          body: "",
          internalDate: Date.now(),
          labelIds: ["SENT"],
          raw: Buffer.from(raw, "base64url").toString("utf8"),
        };
        state.messages.push(m);
        return json({ id: m.id, threadId: m.threadId });
      }
      if (rest === "drafts") {
        const { message } = JSON.parse(body!) as { message: { raw: string; threadId?: string } };
        const d = {
          id: nextId("d"),
          raw: Buffer.from(message.raw, "base64url").toString("utf8"),
          ...(message.threadId ? { threadId: message.threadId } : {}),
        };
        state.drafts.push(d);
        return json({ id: d.id });
      }
      if (rest === "messages/batchModify") {
        const b = JSON.parse(body!) as {
          ids: string[];
          addLabelIds: string[];
          removeLabelIds: string[];
        };
        for (const m of state.messages.filter((x) => b.ids.includes(x.id))) {
          m.labelIds = [
            ...m.labelIds.filter((l) => !b.removeLabelIds.includes(l)),
            ...b.addLabelIds.filter((l) => !m.labelIds.includes(l)),
          ];
        }
        return new Response(null, { status: 204 });
      }
      if (rest === "labels") return json({ labels: state.labels });
      const trash = rest.match(/^messages\/([^/]+)\/trash$/);
      if (trash) {
        const m = state.messages.find((x) => x.id === trash[1]);
        if (m) m.labelIds = ["TRASH"];
        return json({ id: trash[1] });
      }
      const att = rest.match(/^messages\/([^/]+)\/attachments\/([^/]+)$/);
      if (att) {
        const m = state.messages.find((x) => x.id === decodeURIComponent(att[1]!));
        const hit = /^att-(.+)-(\d+)-\d+$/.exec(decodeURIComponent(att[2]!));
        const a = m && hit?.[1] === m.id ? m.attachments?.[Number(hit[2])] : undefined;
        if (!a) return json({ error: { message: "Invalid attachment token" } }, 400);
        const data = bytesOf(a.data);
        return json({ size: data.byteLength, data: Buffer.from(data).toString("base64url") });
      }
      const one = rest.match(/^messages\/([^/]+)$/);
      if (one) {
        const m = state.messages.find((x) => x.id === decodeURIComponent(one[1]!));
        return m ? json(asGmail(m)) : json({ error: { message: "Not Found" } }, 404);
      }
      const thread = rest.match(/^threads\/([^/]+)$/);
      if (thread) {
        const id = decodeURIComponent(thread[1]!);
        const msgs = state.messages.filter((x) => x.threadId === id);
        return msgs.length
          ? json({ id, messages: msgs.map(asGmail) })
          : json({ error: { message: "Not Found" } }, 404);
      }
    }

    const cal = path.match(/^\/calendar\/v3\/calendars\/primary\/events(?:\/([^/]+))?$/);
    if (cal) {
      const id = cal[1] ? decodeURIComponent(cal[1]) : null;
      if (!id && method === "GET")
        return json({
          timeZone: state.timeZone,
          items: state.events.filter((e) => e.status !== "cancelled"),
        });
      if (!id && method === "POST") {
        const b = JSON.parse(body!) as Omit<FakeEvent, "id">;
        const e = { ...b, id: nextId("ev") };
        state.events.push(e);
        return json(e);
      }
      const e = state.events.find((x) => x.id === id);
      if (!e) return json({ error: { message: "Not Found" } }, 404);
      if (method === "GET") return json(e);
      if (method === "PATCH") {
        Object.assign(e, JSON.parse(body!));
        return json(e);
      }
      if (method === "DELETE") {
        e.status = "cancelled";
        return new Response(null, { status: 204 });
      }
    }
    if (url.host === "www.googleapis.com" && path === "/upload/drive/v3/files") {
      const parts = multipart(body ?? "", new Headers(init.headers).get("content-type") ?? "");
      if (url.searchParams.get("uploadType") !== "multipart" || !parts || parts.length !== 2)
        return json({ error: { message: "bad upload" } }, 400);
      const meta = JSON.parse(parts[0]!.body) as { name: string; mimeType: string };
      if (!parts[1]!.type.startsWith("text/html") && !parts[1]!.type.startsWith("text/plain"))
        return json({ error: { message: "unsupported conversion" } }, 400);
      const id = nextId("doc");
      state.createdDocs.push({
        id,
        name: meta.name,
        mimeType: meta.mimeType,
        html: parts[1]!.body,
      });
      state.files.push({ id, name: meta.name, mimeType: meta.mimeType, content: parts[1]!.body });
      return json({
        id,
        name: meta.name,
        webViewLink: `https://docs.google.com/document/d/${id}/edit`,
      });
    }

    const drive = path.match(/^\/drive\/v3\/files(?:\/([^/]+))?(\/export)?$/);
    if (drive && method === "GET") {
      const unquote = (s: string) => s.replace(/\\(.)/g, "$1");
      const lit = "'((?:[^'\\\\]|\\\\.)*)'";
      if (!drive[1]) {
        const q = url.searchParams.get("q") ?? "";
        const words = [...q.matchAll(new RegExp(`(?:name|fullText) contains ${lit}`, "g"))].map(
          (m) => unquote(m[1]!).toLowerCase(),
        );
        const mime = new RegExp(`mimeType = ${lit}`).exec(q)?.[1];
        const hits = state.files.filter((f) => {
          if (q.includes("trashed = false") && f.trashed) return false;
          if (mime && f.mimeType !== unquote(mime)) return false;
          const text = typeof f.content === "string" ? f.content : "";
          return words.every((w) => `${f.name} ${text}`.toLowerCase().includes(w));
        });
        return json({
          files: hits.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime ?? "2026-10-01T10:00:00.000Z",
            owners: [{ displayName: "Owner", emailAddress: f.owner ?? state.email }],
            webViewLink: `https://drive.google.com/file/d/${f.id}/view`,
          })),
        });
      }
      const f = state.files.find((x) => x.id === decodeURIComponent(drive[1]!));
      if (!f) return json({ error: { message: "File not found" } }, 404);
      const bytes = typeof f.content === "string" ? new TextEncoder().encode(f.content) : f.content;
      if (drive[2]) {
        if (EXPORT_TYPES[f.mimeType] !== url.searchParams.get("mimeType"))
          return json({ error: { message: "Export only supports Docs Editors files." } }, 403);
        // Real Docs exports start with a byte-order mark.
        return new Response(`﻿${new TextDecoder().decode(bytes)}`, {
          headers: { "content-type": EXPORT_TYPES[f.mimeType]! },
        });
      }
      if (url.searchParams.get("alt") === "media") {
        if (f.mimeType.startsWith("application/vnd.google-apps."))
          return json({ error: { message: "Use Export for Google Docs files" } }, 403);
        return new Response(bytes, { headers: { "content-type": f.mimeType } });
      }
      return json({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.mimeType.startsWith("application/vnd.google-apps.")
          ? undefined
          : String(bytes.byteLength),
        webViewLink: `https://drive.google.com/file/d/${f.id}/view`,
      });
    }

    if (url.host === "sheets.googleapis.com") {
      const res = sheetsRoute(path, method, url, body);
      if (res) return res;
    }

    if (url.host === "people.googleapis.com") {
      const source =
        path === "/v1/people:searchContacts"
          ? "contacts"
          : path === "/v1/otherContacts:search"
            ? "other"
            : null;
      if (source && url.searchParams.get("readMask")) {
        const q = url.searchParams.get("query") ?? "";
        state.peopleQueries.push(`${source}:${q}`);
        if (!q) return json({});
        const list = source === "contacts" ? state.contacts : state.otherContacts;
        const hits = list.filter((c) =>
          [c.name, ...(c.emails ?? [])].some((s) => s.toLowerCase().includes(q.toLowerCase())),
        );
        return json({
          results: hits.map((c, i) => ({
            person: {
              resourceName: `${source === "contacts" ? "people" : "otherContacts"}/c${i}`,
              names: [{ displayName: c.name }],
              emailAddresses: (c.emails ?? []).map((value) => ({ value })),
              phoneNumbers: (c.phones ?? []).map((value) => ({ value })),
            },
          })),
        });
      }
    }
    return json({ error: { message: `fake google: no route for ${method} ${url}` } }, 404);
  }

  const col = (letters: string) =>
    [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const letters = (i: number): string =>
    (i >= 26 ? letters(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
  const quote = (t: string) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(t) ? t : `'${t.replace(/'/g, "''")}'`;

  /** Resolves an A1 range: the sheet, and the cell bounds (0-based) when it names any. */
  function a1(s: FakeSpreadsheet, range: string) {
    const bang = range.lastIndexOf("!");
    let name = bang >= 0 ? range.slice(0, bang) : range;
    let ref = bang >= 0 ? range.slice(bang + 1) : "";
    if (bang < 0 && /^[A-Z]+\d+(:[A-Z]+\d+)?$/.test(range)) {
      name = s.sheets[0]!.title;
      ref = range;
    }
    name = name.replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
    const sheet = s.sheets.find((x) => x.title === name);
    const m = ref ? /^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(ref) : null;
    if (!sheet || (ref && !m)) return null;
    const single = m && !m[3];
    return {
      sheet,
      r1: m?.[2] ? Number(m[2]) - 1 : 0,
      c1: m ? col(m[1]!) : 0,
      r2: m?.[4] ? Number(m[4]) - 1 : single && m[2] ? Number(m[2]) - 1 : Infinity,
      c2: m?.[3] ? col(m[3]) : single ? col(m[1]!) : Infinity,
    };
  }

  function sheetsRoute(path: string, method: string, url: URL, body: string | undefined) {
    const meta = (s: FakeSpreadsheet) => ({
      spreadsheetId: s.id,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${s.id}/edit`,
      properties: { title: s.title },
      sheets: s.sheets.map((x) => ({
        properties: {
          sheetId: x.sheetId,
          title: x.title,
          gridProperties: {
            rowCount: Math.max(1000, x.rows.length),
            columnCount: Math.max(26, ...x.rows.map((r) => r.length)),
          },
        },
      })),
    });
    if (path === "/v4/spreadsheets" && method === "POST") {
      const b = JSON.parse(body!) as { properties: { title: string } };
      const s: FakeSpreadsheet = {
        id: nextId("sheet-0123456789-"),
        title: b.properties.title,
        sheets: [{ sheetId: 0, title: "Sheet1", rows: [] }],
      };
      state.spreadsheets.push(s);
      return json(meta(s));
    }
    const m = path.match(/^\/v4\/spreadsheets\/([^/]+)(?:\/values\/([^/:]+)(:append)?)?$/);
    if (!m) return null;
    const s = state.spreadsheets.find((x) => x.id === decodeURIComponent(m[1]!));
    if (!s) return json({ error: { message: "Requested entity was not found." } }, 404);
    if (!m[2]) return json(meta(s));
    const range = decodeURIComponent(m[2]);
    const r = a1(s, range);
    if (!r) return json({ error: { message: `Unable to parse range: ${range}` } }, 400);
    if (method === "GET") {
      const rows = r.sheet.rows
        .slice(r.r1, r.r2 + 1)
        .map((row) => row.slice(r.c1, r.c2 === Infinity ? undefined : r.c2 + 1).map(String));
      const width = Math.max(1, ...rows.map((x) => x.length));
      const end = `${letters(r.c1 + width - 1)}${r.r1 + Math.max(rows.length, 1)}`;
      return json({
        range: `${quote(r.sheet.title)}!${letters(r.c1)}${r.r1 + 1}:${end}`,
        majorDimension: "ROWS",
        ...(rows.length ? { values: rows } : {}),
      });
    }
    const option = url.searchParams.get("valueInputOption");
    if (!option) return json({ error: { message: "valueInputOption is required" } }, 400);
    const values = (JSON.parse(body!) as { values: (string | number | boolean)[][] }).values;
    const start = m[3] ? r.sheet.rows.length : r.r1;
    const c1 = m[3] ? 0 : r.c1;
    values.forEach((row, i) => {
      r.sheet.rows[start + i] ??= [];
      const target = r.sheet.rows[start + i]!;
      row.forEach((v, j) => {
        target[c1 + j] = v;
      });
    });
    for (const row of r.sheet.rows) for (let j = 0; j < row.length; j++) row[j] ??= "";
    const width = Math.max(...values.map((x) => x.length));
    const written = `${quote(r.sheet.title)}!${letters(c1)}${start + 1}:${letters(c1 + width - 1)}${start + values.length}`;
    state.sheetWrites.push({ kind: m[3] ? "append" : "update", range, valueInputOption: option });
    const result = {
      spreadsheetId: s.id,
      updatedRange: written,
      updatedRows: values.length,
      updatedCells: values.reduce((n, x) => n + x.length, 0),
    };
    return json(m[3] ? { spreadsheetId: s.id, updates: result } : result);
  }

  const f = (async (input: string | URL | Request, init: RequestInit = {}) =>
    handle(new URL(input instanceof Request ? input.url : input.toString()), init)) as typeof fetch;

  return {
    state,
    fetch: f,
    /** Adds an incoming message to the inbox. */
    receive(m: Partial<FakeMessage> & Pick<FakeMessage, "from" | "subject">): FakeMessage {
      const msg: FakeMessage = {
        id: nextId("m"),
        threadId: nextId("t"),
        to: state.email,
        body: "",
        internalDate: Date.now(),
        labelIds: ["INBOX", "UNREAD"],
        messageId: `<${n}@mail.example.com>`,
        ...m,
      };
      state.messages.push(msg);
      return msg;
    },
    /** Adds a message the user sent (for reading their sent mail). */
    sent(m: Partial<FakeMessage> & Pick<FakeMessage, "to" | "subject" | "body">): FakeMessage {
      const msg: FakeMessage = {
        id: nextId("s"),
        threadId: nextId("t"),
        from: state.email,
        internalDate: Date.now(),
        labelIds: ["SENT"],
        ...m,
      };
      state.messages.push(msg);
      return msg;
    },
  };
}
