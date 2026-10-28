import { type ToolDefinition, ToolRegistry } from "@synapse/core";
import type { Db, SecretBox } from "@synapse/db";
import { type Embedder, knowledgeTool } from "./builtin/knowledge";
import { memoryTools } from "./builtin/memory";
import { planTool } from "./builtin/plan";
import { type WebSearchConfig, webFetchTool, webSearchTool } from "./builtin/web";
import { calendarTools } from "./google/calendar";
import { type GoogleAppConfig, GoogleClient } from "./google/client";
import { gmailTools } from "./google/gmail";
import { McpSession } from "./mcp/client";
import type { OAuthAppConfig } from "./mcp/oauth";

export * from "./builtin/knowledge";
export { loadMemoryBlock, loadWritingStyle } from "./builtin/memory";
export { PLAN_TOOL } from "./builtin/plan";
export { htmlToText, type WebSearchConfig } from "./builtin/web";
export * from "./google/client";
export {
  buildMime,
  type MessageSummary,
  newMessagesSince,
  ownText,
  type SentSample,
  sentSamples,
} from "./google/gmail";
export * from "./mcp/client";
export * from "./mcp/oauth";
export * from "./ssrf";

export interface ToolsetConfig {
  db: Db;
  box: SecretBox;
  app: OAuthAppConfig;
  webSearch: WebSearchConfig | null;
  embedder: Embedder | null;
  /** Set when the operator configured a Google OAuth app. */
  google: GoogleAppConfig | null;
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
    planTool(cfg.db),
    ...(cfg.webSearch ? [webSearchTool(cfg.webSearch)] : []),
  ];
  if (cfg.google) {
    const google = await GoogleClient.forUser(cfg.google, cfg.db, cfg.box, userId);
    if (google) {
      const client = async () => google;
      builtin.push(...gmailTools(client), ...calendarTools(client));
    }
  }
  const registry = new ToolRegistry(builtin);
  for (const tool of await mcp.tools(userId)) {
    if (!registry.get(tool.name)) registry.add(tool);
  }
  return { registry, close: () => mcp.close() };
}
