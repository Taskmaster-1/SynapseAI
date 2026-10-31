import variant from "@jitl/quickjs-wasmfile-release-sync";
import type { JSONValue } from "ai";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten-core";

/**
 * JavaScript sandbox for run_code: QuickJS compiled to WebAssembly. The guest gets the
 * language and its standard library (Math, Date, JSON, RegExp…) and nothing else:
 * no network, filesystem, timers, modules or host objects. The only bridges are the three
 * helpers set up in PRELUDE, which take and return strings.
 */

export const SANDBOX_LIMITS = {
  timeMs: 5_000,
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024,
  /** console output and the serialized result, each. */
  outputChars: 20_000,
  savedFiles: 5,
  savedFileBytes: 1024 * 1024,
};

export interface SandboxJob {
  code: string;
  /** Exposed to the code as the global `files`, by name. */
  files: Record<string, string>;
  /** Overrides for tests. */
  limits?: Partial<typeof SANDBOX_LIMITS>;
}

export interface SavedText {
  name: string;
  text: string;
  mimeType: string;
}

export type SandboxResult =
  | {
      ok: true;
      /** The last expression's value, or a top-level `return`'s. Absent when undefined. */
      result?: JSONValue;
      output: string;
      truncated: boolean;
      saved: SavedText[];
    }
  | { ok: false; error: string; output: string };

/** Runs inside the guest before the user's code; `__print` and `__save` are host functions. */
const PRELUDE = `(() => {
  const print = globalThis.__print, save = globalThis.__save;
  delete globalThis.__print;
  delete globalThis.__save;
  const show = (v) => {
    if (typeof v === "string") return v;
    try {
      const s = JSON.stringify(v);
      return s === undefined ? String(v) : s;
    } catch {
      return String(v);
    }
  };
  const log = (...args) => { print(args.map(show).join(" ")); };
  globalThis.console = { log, info: log, warn: log, error: log, debug: log };
  globalThis.csv = function csv(text, delimiter = ",") {
    text = String(text);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [], field = "", quoted = false, i = 0;
    const endRow = () => {
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
    };
    while (i < text.length) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
        if (c === '"') quoted = false;
        else field += c;
        i++;
      } else if (c === '"' && field === "") { quoted = true; i++; }
      else if (c === delimiter) { row.push(field); field = ""; i++; }
      else if (c === "\\r" || c === "\\n") {
        endRow();
        i += c === "\\r" && text[i + 1] === "\\n" ? 2 : 1;
      } else { field += c; i++; }
    }
    if (field !== "" || row.length > 0) endRow();
    return rows;
  };
  globalThis.saveFile = function saveFile(name, text, mimeType) {
    return save(String(name), typeof text === "string" ? text : show(text), mimeType == null ? "" : String(mimeType));
  };
})();`;

let module: Promise<QuickJSWASMModule> | null = null;

/**
 * Runs one job in a fresh QuickJS runtime, disposed before returning even on error. The guest
 * runs synchronously and blocks this thread until it ends or hits a limit.
 */
export async function runInSandbox(job: SandboxJob): Promise<SandboxResult> {
  const limits = { ...SANDBOX_LIMITS, ...job.limits };
  module ??= newQuickJSWASMModuleFromVariant(variant);
  const runtime = (await module).newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.timeMs));
  const ctx = runtime.newContext();

  let output = "";
  let truncated = false;
  const saved: SavedText[] = [];
  try {
    const print = ctx.newFunction("__print", (line) => {
      if (truncated) return;
      const text = `${ctx.getString(line)}\n`;
      if (output.length + text.length > limits.outputChars) {
        output += text.slice(0, limits.outputChars - output.length);
        truncated = true;
      } else output += text;
    });
    const save = ctx.newFunction("__save", (nameH, textH, typeH) => {
      const name = ctx
        .getString(nameH)
        .replace(/[\\/\p{Cc}]/gu, "_")
        .trim()
        .slice(0, 200);
      const text = ctx.getString(textH);
      const mimeType = ctx.getString(typeH) || mimeFor(name);
      const fail = (message: string) => ({ error: ctx.newError(message) });
      if (!name) return fail("saveFile needs a file name");
      if (!/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) return fail(`Invalid MIME type ${mimeType}`);
      if (saved.length >= limits.savedFiles)
        return fail(`At most ${limits.savedFiles} files can be saved per run`);
      if (new TextEncoder().encode(text).byteLength > limits.savedFileBytes)
        return fail(`A saved file can be at most ${limits.savedFileBytes} bytes`);
      saved.push({ name, text, mimeType });
      return ctx.newString(name);
    });
    ctx.setProp(ctx.global, "__print", print);
    ctx.setProp(ctx.global, "__save", save);
    print.dispose();
    save.dispose();
    const files = ctx.newObject();
    for (const [name, text] of Object.entries(job.files)) {
      const value = ctx.newString(text);
      ctx.setProp(files, name, value);
      value.dispose();
    }
    ctx.setProp(ctx.global, "files", files);
    files.dispose();
    ctx.unwrapResult(ctx.evalCode(PRELUDE, "prelude.js")).dispose();

    let result = ctx.evalCode(job.code, "code.js");
    // A top-level `return` is a syntax error in a script; nothing ran, so run it as a
    // function body instead. Kept on the first line so error line numbers still match.
    if (result.error && isReturnOutsideFunction(ctx, result.error)) {
      result.error.dispose();
      result = ctx.evalCode(`(function () {${job.code}\n})()`, "code.js");
    }
    if (result.error) {
      const error = describeError(ctx, result.error, limits);
      result.error.dispose();
      return { ok: false, error, output };
    }
    const value = resultOf(ctx, result.value, limits.outputChars);
    result.value.dispose();
    return {
      ok: true,
      ...(value === undefined ? {} : { result: value }),
      output,
      truncated,
      saved,
    };
  } catch (error) {
    // Out of memory while the host builds values (a huge file) lands here.
    return { ok: false, error: error instanceof Error ? error.message : String(error), output };
  } finally {
    ctx.dispose();
    runtime.dispose();
  }
}

function isReturnOutsideFunction(ctx: QuickJSContext, error: QuickJSHandle): boolean {
  const e = ctx.dump(error) as { name?: string; message?: string };
  return e?.name === "SyntaxError" && /return not in a function/.test(e.message ?? "");
}

/** "ReferenceError: 'foo' is not defined (line 3)". */
function describeError(
  ctx: QuickJSContext,
  handle: QuickJSHandle,
  limits: typeof SANDBOX_LIMITS,
): string {
  const e = ctx.dump(handle) as
    | { name?: string; message?: string; stack?: string; lineNumber?: number }
    | string
    | null;
  if (!e || typeof e !== "object") return `Uncaught ${JSON.stringify(e) ?? String(e)}`;
  const line = e.stack?.match(/code\.js:(\d+)/)?.[1] ?? e.lineNumber;
  let message = `${e.name ?? "Error"}: ${e.message ?? ""}`;
  if (message === "InternalError: interrupted")
    message = `Stopped: the code ran past the time limit (${limits.timeMs / 1000} s)`;
  else if (message === "InternalError: out of memory")
    message = `Stopped: the code ran out of memory (${limits.memoryBytes / 1024 / 1024} MB)`;
  return line && !message.startsWith("Stopped") ? `${message} (line ${line})` : message;
}

function resultOf(ctx: QuickJSContext, handle: QuickJSHandle, max: number): JSONValue | undefined {
  const type = ctx.typeof(handle);
  if (type === "undefined") return undefined;
  if (type === "function") return "[function]";
  const dumped = ctx.dump(handle) as unknown;
  const json = JSON.stringify(dumped);
  if (json === undefined) return String(dumped);
  if (json.length > max) return `${json.slice(0, max)}… (truncated; ${json.length} chars)`;
  return JSON.parse(json) as JSONValue;
}

function mimeFor(name: string): string {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const types: Record<string, string> = {
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    json: "application/json",
    md: "text/markdown",
    html: "text/html",
    xml: "application/xml",
    ics: "text/calendar",
  };
  return (ext && types[ext]) || "text/plain";
}

/**
 * Runs a job on a worker thread so a busy guest never blocks the server's event loop, and
 * so the worker can be terminated outright if the interrupt handler somehow never fires.
 */
export function runSandboxed(job: SandboxJob, signal?: AbortSignal): Promise<SandboxResult> {
  const timeMs = job.limits?.timeMs ?? SANDBOX_LIMITS.timeMs;
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./sandbox-worker.ts", import.meta.url).href);
    const finish = (result: SandboxResult) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      resolve(result);
    };
    const onAbort = () => finish({ ok: false, error: "Cancelled", output: "" });
    // The guest's own deadline fires first; this is the backstop.
    const timer = setTimeout(
      () => finish({ ok: false, error: "Stopped: the code ran past the time limit", output: "" }),
      timeMs + 5_000,
    );
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<SandboxResult>) => finish(event.data);
    worker.onerror = (event) =>
      finish({ ok: false, error: `Sandbox failed: ${event.message}`, output: "" });
    worker.postMessage(job);
  });
}
