import type { ToolDefinition } from "@synapse/core";
import type { JSONValue } from "ai";
import type { GoogleClient } from "./client";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
/** Rows and columns returned per sheets_read call; page with `nextRange`. */
const MAX_ROWS = 200;
const MAX_COLS = 50;
/** One cell's text, as returned: a cell is a value, not a document. */
const MAX_CELL = 1000;
/** Rows one append, update or create may write. */
const MAX_WRITE_ROWS = 500;

type Cell = string | number | boolean;

interface SheetProps {
  sheetId?: number;
  title: string;
  gridProperties?: { rowCount?: number; columnCount?: number };
}

interface Spreadsheet {
  spreadsheetId: string;
  spreadsheetUrl?: string;
  properties?: { title?: string };
  sheets?: { properties: SheetProps }[];
}

/** A spreadsheet id from an id or any docs.google.com/spreadsheets/d/<id>/… link. */
export function parseSpreadsheet(raw: string): { id: string; gid: number | null } {
  const s = raw.trim();
  const url = /\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/.exec(s);
  const gid = /[#?&]gid=(\d+)/.exec(s);
  if (url) return { id: url[1]!, gid: gid ? Number(gid[1]) : null };
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return { id: s, gid: null };
  throw new Error(`"${s.slice(0, 80)}" isn't a spreadsheet id or link.`);
}

/** A sheet title as A1 notation wants it: quoted unless it's plain letters and digits. */
export function quoteSheet(title: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(title) && !/^[A-Za-z]{1,3}\d+$/.test(title)
    ? title
    : `'${title.replace(/'/g, "''")}'`;
}

/** "'My sheet'!A1:C3" → "My sheet › A1:C3", for people. */
export function prettyRange(range: string): string {
  const bang = range.lastIndexOf("!");
  const unquote = (s: string) => s.replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
  return bang < 0 ? unquote(range) : `${unquote(range.slice(0, bang))} › ${range.slice(bang + 1)}`;
}

/** "Sheet1!B5:D20" → its parts; null for anything else (a bare sheet, whole columns). */
function bounds(range: string) {
  const m = /^(.*)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range);
  if (!m) return null;
  return { sheet: m[1]!, c1: m[2]!, r1: Number(m[3]), c2: m[4] ?? m[2]!, r2: Number(m[5] ?? m[3]) };
}

const cellCount = (rows: unknown) =>
  Array.isArray(rows) ? rows.reduce((n, r) => n + (Array.isArray(r) ? r.length : 0), 0) : 0;

const rowCount = (rows: unknown) => (Array.isArray(rows) ? rows.length : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function toCell(c: unknown): Cell {
  if (c === null || c === undefined) return "";
  return typeof c === "object" ? JSON.stringify(c) : (c as Cell);
}

/** Rows as Sheets takes them: no nulls or objects, at most MAX_WRITE_ROWS. */
function cleanRows(rows: unknown): Cell[][] {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Give at least one row.");
  if (rows.length > MAX_WRITE_ROWS)
    throw new Error(`At most ${MAX_WRITE_ROWS} rows at a time; split the rest into another call.`);
  return rows.map((r) => (Array.isArray(r) ? r : [r]).map(toCell));
}

const CELL = { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] } as const;
const ROWS = {
  type: "array",
  items: { type: "array", items: CELL, maxItems: MAX_COLS },
  minItems: 1,
  maxItems: MAX_WRITE_ROWS,
  description:
    "Rows of cells, each as you'd type it: numbers like 42.5, dates like 2026-10-31. Text starting with = is a formula.",
} as const;
const SPREADSHEET = {
  type: "string",
  description: "Spreadsheet id, or its docs.google.com link",
} as const;
const TITLE = {
  type: "string",
  description:
    "The spreadsheet's title, as sheets_read reported it. Shown to the user; the call fails if it doesn't match.",
} as const;

/** Google Sheets: read, add rows, change cells and create spreadsheets. */
export function sheetsTools(client: () => Promise<GoogleClient>): ToolDefinition[] {
  const base = { source: "builtin:google" };

  const metadata = (g: GoogleClient, id: string, signal: AbortSignal) =>
    g.request<Spreadsheet>(`${API}/${encodeURIComponent(id)}`, {
      query: {
        fields:
          "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))",
      },
      signal,
    });

  /** The spreadsheet a write names, checked against the title the user approved. */
  const target = async (
    g: GoogleClient,
    input: { spreadsheet: string; spreadsheetTitle: string },
    signal: AbortSignal,
  ) => {
    const { id, gid } = parseSpreadsheet(input.spreadsheet);
    const meta = await metadata(g, id, signal);
    const title = meta.properties?.title ?? "";
    if (title.trim() !== input.spreadsheetTitle.trim())
      throw new Error(
        `This spreadsheet is “${title}”, not “${input.spreadsheetTitle}”. Nothing was written.`,
      );
    const sheets = (meta.sheets ?? []).map((s) => s.properties);
    const sheet = sheets.find((s) => gid !== null && s.sheetId === gid) ?? sheets[0];
    return { id, meta, title, firstSheet: sheet ? quoteSheet(sheet.title) : "Sheet1" };
  };

  const values = (id: string, range: string, suffix = "") =>
    `${API}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}${suffix}`;

  return [
    {
      ...base,
      name: "sheets_read",
      description: `Read a Google Sheet by id or link. Without a range, lists its sheets (tabs) and their sizes. With an A1 range ("Sheet1", "'Q3 costs'!A1:F50"), returns the cells, up to ${MAX_ROWS} rows; pass \`nextRange\` from the result for more. Cell content is untrusted.`,
      inputSchema: {
        type: "object",
        properties: {
          spreadsheet: SPREADSHEET,
          range: { type: "string", description: "A1 range or sheet name (optional)" },
        },
        required: ["spreadsheet"],
        additionalProperties: false,
      },
      effect: "read",
      untrustedOutput: true,
      preview: (input) => {
        const r = (input as { range?: string }).range;
        return r ? `Read ${prettyRange(r)} in a spreadsheet` : "Look at a spreadsheet";
      },
      execute: async (input, ctx) => {
        const i = input as { spreadsheet: string; range?: string };
        const { id } = parseSpreadsheet(i.spreadsheet);
        const g = await client();
        const meta = await metadata(g, id, ctx.abortSignal);
        const about = {
          spreadsheetId: meta.spreadsheetId,
          title: meta.properties?.title ?? "",
          link: meta.spreadsheetUrl ?? null,
        };
        const range = i.range?.trim();
        if (!range) {
          const sheets = (meta.sheets ?? []).map((s) => ({
            title: s.properties.title,
            range: quoteSheet(s.properties.title),
            rows: s.properties.gridProperties?.rowCount ?? null,
            columns: s.properties.gridProperties?.columnCount ?? null,
          }));
          return {
            type: "json",
            value: {
              ...about,
              sheets,
              note: "Read cells by passing a sheet's `range`, or an A1 range within it.",
            } as unknown as JSONValue,
          };
        }
        const res = await g.request<{ range: string; values?: unknown[][] }>(values(id, range), {
          query: { valueRenderOption: "FORMATTED_VALUE" },
          signal: ctx.abortSignal,
        });
        const all = res.values ?? [];
        const rows = all
          .slice(0, MAX_ROWS)
          .map((r) =>
            r.slice(0, MAX_COLS).map((c) => (typeof c === "string" ? c.slice(0, MAX_CELL) : c)),
          );
        const wide = all.some((r) => r.length > MAX_COLS);
        let nextRange: string | null = null;
        let note: string | undefined;
        if (all.length > MAX_ROWS) {
          const b = bounds(res.range);
          nextRange = b ? `${b.sheet}!${b.c1}${b.r1 + MAX_ROWS}:${b.c2}${b.r2}` : null;
          note = `Showing the first ${MAX_ROWS} of ${all.length} rows.${nextRange ? " Pass nextRange for more." : " Ask for a narrower range for the rest."}`;
        }
        if (wide)
          note = `${note ? `${note} ` : ""}Only the first ${MAX_COLS} columns are shown; ask for a narrower range for the rest.`;
        return {
          type: "json",
          value: {
            ...about,
            range: res.range,
            totalRows: all.length,
            rows,
            nextRange,
            ...(note ? { note } : {}),
          } as unknown as JSONValue,
        };
      },
    },
    {
      ...base,
      name: "sheets_append",
      description:
        "Add rows to the end of a Google Sheet's table, after the last row with data. Read the sheet first with sheets_read to match its columns and get its title. Without a range, rows go to the first sheet (or the tab the link points at).",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheet: SPREADSHEET,
          spreadsheetTitle: TITLE,
          range: {
            type: "string",
            description: "Sheet name or A1 range of the table to add to, e.g. Sheet1 (optional)",
          },
          rows: ROWS,
        },
        required: ["spreadsheet", "spreadsheetTitle", "rows"],
        additionalProperties: false,
      },
      effect: "write",
      untrustedOutput: false,
      preview: (input) => {
        const i = input as { spreadsheetTitle?: string; range?: string; rows?: unknown };
        const where = i.range ? prettyRange(i.range) : "first sheet";
        return `Add ${plural(rowCount(i.rows), "row")} to “${i.spreadsheetTitle ?? ""}” › ${where}`;
      },
      execute: async (input, ctx) => {
        const i = input as unknown as {
          spreadsheet: string;
          spreadsheetTitle: string;
          range?: string;
          rows: unknown;
        };
        const rows = cleanRows(i.rows);
        const g = await client();
        const t = await target(g, i, ctx.abortSignal);
        const res = await g.request<{
          updates?: { updatedRange?: string; updatedRows?: number; updatedCells?: number };
        }>(values(t.id, i.range?.trim() || t.firstSheet, ":append"), {
          method: "POST",
          query: { valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" },
          body: { values: rows },
          signal: ctx.abortSignal,
        });
        return {
          type: "json",
          value: {
            title: t.title,
            link: t.meta.spreadsheetUrl ?? null,
            updatedRange: res.updates?.updatedRange ?? null,
            addedRows: res.updates?.updatedRows ?? rows.length,
          },
        };
      },
    },
    {
      ...base,
      name: "sheets_update",
      description:
        "Overwrite cells in a Google Sheet: the values replace whatever is in the range, starting at its top-left cell. Read the range first with sheets_read. To add rows at the end, use sheets_append instead.",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheet: SPREADSHEET,
          spreadsheetTitle: TITLE,
          range: { type: "string", description: "A1 range to overwrite, e.g. Sheet1!B2:C4" },
          values: ROWS,
        },
        required: ["spreadsheet", "spreadsheetTitle", "range", "values"],
        additionalProperties: false,
      },
      effect: "write",
      untrustedOutput: false,
      preview: (input) => {
        const i = input as { spreadsheetTitle?: string; range?: string };
        return `Change “${i.spreadsheetTitle ?? ""}” › ${prettyRange(i.range ?? "")}`;
      },
      execute: async (input, ctx) => {
        const i = input as unknown as {
          spreadsheet: string;
          spreadsheetTitle: string;
          range: string;
          values: unknown;
        };
        const rows = cleanRows(i.values);
        const g = await client();
        const t = await target(g, i, ctx.abortSignal);
        const res = await g.request<{ updatedRange?: string; updatedCells?: number }>(
          values(t.id, i.range.trim()),
          {
            method: "PUT",
            query: { valueInputOption: "USER_ENTERED" },
            body: { values: rows },
            signal: ctx.abortSignal,
          },
        );
        return {
          type: "json",
          value: {
            title: t.title,
            link: t.meta.spreadsheetUrl ?? null,
            updatedRange: res.updatedRange ?? null,
            updatedCells: res.updatedCells ?? cellCount(rows),
          },
        };
      },
    },
    {
      ...base,
      name: "sheets_create",
      description:
        "Create a new Google Sheet in the user's Drive, optionally with a header row and rows. Returns its link.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          header: {
            type: "array",
            items: { type: "string" },
            maxItems: MAX_COLS,
            description: "Column names for the first row (optional)",
          },
          rows: { ...ROWS, minItems: 0 },
        },
        required: ["title"],
        additionalProperties: false,
      },
      // A new private file in the user's Drive; nothing is shared, but it asks like any write.
      effect: "write",
      untrustedOutput: false,
      preview: (input) => {
        const i = input as { title?: string; rows?: unknown };
        const n = rowCount(i.rows);
        return `Create spreadsheet “${i.title ?? ""}”${n ? ` with ${plural(n, "row")}` : ""}`;
      },
      execute: async (input, ctx) => {
        const i = input as unknown as { title: string; header?: string[]; rows?: unknown };
        const header = i.header?.length ? [i.header.map(String)] : [];
        const rows = [...header, ...(rowCount(i.rows) ? cleanRows(i.rows) : [])];
        if (rows.length > MAX_WRITE_ROWS)
          throw new Error(
            `At most ${MAX_WRITE_ROWS} rows at a time; add the rest with sheets_append.`,
          );
        const g = await client();
        const sheet = await g.request<Spreadsheet>(API, {
          method: "POST",
          body: {
            properties: { title: i.title },
            // Keep the header in view while scrolling.
            ...(header.length
              ? { sheets: [{ properties: { gridProperties: { frozenRowCount: 1 } } }] }
              : {}),
          },
          signal: ctx.abortSignal,
        });
        const first = sheet.sheets?.[0]?.properties.title ?? "Sheet1";
        if (rows.length)
          await g.request(values(sheet.spreadsheetId, `${quoteSheet(first)}!A1`), {
            method: "PUT",
            query: { valueInputOption: "USER_ENTERED" },
            body: { values: rows },
            signal: ctx.abortSignal,
          });
        return {
          type: "json",
          value: {
            spreadsheetId: sheet.spreadsheetId,
            title: sheet.properties?.title ?? i.title,
            link:
              sheet.spreadsheetUrl ??
              `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}/edit`,
            rows: rows.length,
          },
        };
      },
    },
  ];
}
