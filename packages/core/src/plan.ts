import type { JSONValue } from "ai";

/** Decision reason for a call that matched a step of a plan the user approved. */
export const PLAN_GRANT_REASON = "Part of the plan you approved";

/** JSON with object keys sorted at every level, so equal inputs serialise identically. */
export function canonicalJson(value: JSONValue | undefined): string {
  if (value === null || value === undefined || typeof value !== "object")
    return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, JSONValue | undefined>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** SHA-256 (hex) of the canonical JSON of a tool input. */
export async function hashInput(value: JSONValue | undefined): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
