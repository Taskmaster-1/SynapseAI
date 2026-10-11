import { type ToolDefinition, ToolRegistry } from "@synapse/core";
import type { Db, SecretBox } from "@synapse/db";
import { type Embedder, knowledgeTool } from "./builtin/knowledge";
import { memoryTools } from "./builtin/memory";
import { type WebSearchConfig, webFetchTool, webSearchTool } from "./builtin/web";
import { McpSession } from "./mcp/client";
import type { OAuthAppConfig } from "./mcp/oauth";

export * from "./builtin/knowledge";
export { loadMemoryBlock } from "./builtin/memory";
export { htmlToText, type WebSearchConfig } from "./builtin/web";
export * from "./mcp/client";
export * from "./mcp/oauth";
export * from "./ssrf";

export interface ToolsetConfig {
  db: Db;
  box: SecretBox;
  app: OAuthAppConfig;
  webSearch: WebSearchConfig | null;
  embedder: Embedder | null;
}

/**
 * Builds the tool registry for one run: built-ins plus the user's active MCP connections.
 * Call `close()` when the run releases its lease.
 */
export async function buildToolset(cfg: ToolsetConfig, userId: string) {
  const mcp = new McpSession(cfg.db, cfg.box, cfg.app);
  const builtin: ToolDefinition[] = [
    webFetchTool(),
    knowledgeTool(cfg.db, cfg.embedder),
    ...memoryTools(cfg.db),
    ...(cfg.webSearch ? [webSearchTool(cfg.webSearch)] : []),
  ];
  const registry = new ToolRegistry(builtin);
  for (const tool of await mcp.tools(userId)) {
    if (!registry.get(tool.name)) registry.add(tool);
  }
  return { registry, close: () => mcp.close() };
}
