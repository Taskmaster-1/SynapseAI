import type { ModelMessage, SystemModelMessage, Tool } from "ai";
import type { ModelSpec } from "./models";

/**
 * Anthropic prompt caching. Claude only reuses a prefix up to an explicit breakpoint, so we
 * mark three: the last tool definition (tools are stable across steps), the system prompt,
 * and the last history message (a rolling breakpoint: the next step reads everything up to
 * here from cache and writes only what it appends). Anthropic allows at most four.
 *
 * Other providers cache implicitly and ignore the `anthropic` provider options, so this is
 * a no-op for them; the gateway passes provider options through to the routed provider.
 */
const BREAKPOINT = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

export function usesAnthropicCache(spec: ModelSpec): boolean {
  return (
    spec.provider === "anthropic" ||
    (spec.provider === "gateway" && spec.modelId.startsWith("anthropic/"))
  );
}

export function cachedInstructions(spec: ModelSpec, system: string): string | SystemModelMessage {
  return usesAnthropicCache(spec)
    ? { role: "system", content: system, providerOptions: BREAKPOINT }
    : system;
}

export function cachedTools(spec: ModelSpec, tools: Record<string, Tool>): Record<string, Tool> {
  const names = Object.keys(tools);
  const last = names.at(-1);
  if (!usesAnthropicCache(spec) || !last) return tools;
  return { ...tools, [last]: { ...tools[last]!, providerOptions: BREAKPOINT } };
}

/** Copies the last message with a breakpoint; stored messages are never mutated. */
export function cachedMessages(spec: ModelSpec, messages: ModelMessage[]): ModelMessage[] {
  const last = messages.at(-1);
  if (!usesAnthropicCache(spec) || !last) return messages;
  return [
    ...messages.slice(0, -1),
    { ...last, providerOptions: { ...last.providerOptions, ...BREAKPOINT } } as ModelMessage,
  ];
}
