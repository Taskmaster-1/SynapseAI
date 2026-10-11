import type { JSONSchema7, JSONValue } from "ai";
import type { Effect, ToolOutput } from "./types";

export interface ToolContext {
  userId: string;
  chatId: string;
  runId: string;
  toolCallId: string;
  abortSignal: AbortSignal;
}

export interface ToolDefinition {
  /** Model-facing name. `^[a-zA-Z0-9_-]{1,64}$`. */
  name: string;
  description: string;
  inputSchema: JSONSchema7;
  /** What the tool does to the outside world. Undeclared MCP tools are treated as "write". */
  effect: Effect;
  /** True when output can contain third-party content (email bodies, web pages, files). */
  untrustedOutput: boolean;
  /** Where the tool comes from, e.g. "builtin" or "mcp:github". Shown in approvals and audit. */
  source: string;
  /** Short human-readable description of a specific call, shown on approval cards. */
  preview?: (input: JSONValue) => string;
  execute: (input: JSONValue, ctx: ToolContext) => Promise<ToolOutput>;
}

/** A set of tools resolved for one run. Built-ins plus the user's connected MCP servers. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: Iterable<ToolDefinition> = []) {
    for (const tool of tools) this.add(tool);
  }

  add(tool: ToolDefinition): void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) {
      throw new Error(`invalid tool name: ${tool.name}`);
    }
    if (this.tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Sorted so the tool block is byte-stable across requests (prompt cache). */
  list(): ToolDefinition[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
