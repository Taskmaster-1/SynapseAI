import { type ToolDefinition, ToolRegistry } from "@synapse/core";
import { type Db, type SecretBox, schema } from "@synapse/db";
import { eq } from "drizzle-orm";
import { fileReadTool, loadFiles, saveFile } from "./builtin/files";
import { type Embedder, knowledgeTool } from "./builtin/knowledge";
import { memoryTools } from "./builtin/memory";
import { planTool } from "./builtin/plan";
import { scheduleTools } from "./builtin/schedule";
import { enabledSkills, skillTools } from "./builtin/skills";
import { type WebSearchConfig, webFetchTool, webSearchTool } from "./builtin/web";
import { type GitHubAppConfig, GitHubClient } from "./github/client";
import { githubTools } from "./github/tools";
import { calendarTools } from "./google/calendar";
import {
  GOOGLE_SCOPE_GROUPS,
  type GoogleAppConfig,
  GoogleClient,
  missingGoogleGroups,
} from "./google/client";
import { contactsTools } from "./google/contacts";
import { driveTools } from "./google/drive";
import { gmailTools } from "./google/gmail";
import { sheetsTools } from "./google/sheets";
import { McpSession } from "./mcp/client";
import type { OAuthAppConfig } from "./mcp/oauth";
import { type SlackToolsConfig, SlackUserClient } from "./slack/client";
import { slackTools } from "./slack/tools";

export * from "./builtin/files";
export * from "./builtin/knowledge";
export { loadMemoryBlock, loadWritingStyle } from "./builtin/memory";
export { PLAN_TOOL } from "./builtin/plan";
export { formatWhen, MAX_SCHEDULED, schedulePreview } from "./builtin/schedule";
export {
  BUILTIN_SKILL_FILES,
  BUILTIN_SKILLS,
  enabledSkills,
  isBuiltinSkill,
  MAX_USER_SKILLS,
  type SkillEntry,
  skillCatalog,
  skillFromFiles,
} from "./builtin/skills";
export { htmlToText, type WebSearchConfig } from "./builtin/web";
export * from "./github/client";
export { parseIssueRef, parseRepo } from "./github/tools";
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
export * from "./slack/client";
export * from "./ssrf";

export interface ToolsetConfig {
  db: Db;
  box: SecretBox;
  app: OAuthAppConfig;
  webSearch: WebSearchConfig | null;
  embedder: Embedder | null;
  /** Set when the operator configured a Google OAuth app. */
  google: GoogleAppConfig | null;
  /** Set when the operator configured a Slack app (the server's Slack config fits). */
  slack: SlackToolsConfig | null;
  /** Set when the operator configured a GitHub OAuth app for the tools. */
  github?: GitHubAppConfig | null;
}

/**
 * Builds the tool registry for one run: built-ins plus the user's active MCP connections.
 * `skills` is the run's skill catalog, the same list `load_skill` serves and the prompt
 * shows. Call `close()` when the run releases its lease.
 */
export async function buildToolset(cfg: ToolsetConfig, userId: string) {
  const mcp = new McpSession(cfg.db, cfg.box, cfg.app);
  const skills = await enabledSkills(cfg.db, userId);
  const [settings] = await cfg.db
    .select({ timezone: schema.userSettings.timezone })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId));
  const builtin: ToolDefinition[] = [
    webFetchTool(),
    knowledgeTool(cfg.db, cfg.embedder),
    fileReadTool(cfg.db),
    ...memoryTools(cfg.db),
    planTool(cfg.db),
    ...scheduleTools(cfg.db, settings?.timezone ?? null),
    ...skillTools(cfg.db, skills),
    ...(cfg.webSearch ? [webSearchTool(cfg.webSearch)] : []),
  ];
  /** Labels of Google tool groups withheld until the user reconnects with more scopes. */
  let google: { missing: string[] } | null = null;
  if (cfg.google) {
    const g = await GoogleClient.forUser(cfg.google, cfg.db, cfg.box, userId);
    if (g) {
      const client = async () => g;
      const attachments = (userId: string, ids: string[]) => loadFiles(cfg.db, userId, ids);
      const save = (userId: string, file: { name: string; mimeType: string; data: Uint8Array }) =>
        saveFile(cfg.db, cfg.embedder, { userId, ...file });
      builtin.push(...gmailTools(client, attachments, save), ...calendarTools(client));
      if (g.has("drive")) builtin.push(...driveTools(client));
      if (g.has("contacts")) builtin.push(...contactsTools(client));
      if (g.has("sheets")) builtin.push(...sheetsTools(client));
      google = {
        missing: missingGoogleGroups(g.scopes).map((k) => GOOGLE_SCOPE_GROUPS[k].label),
      };
    }
  }
  if (cfg.slack) {
    // Only with a user token: installs from before it existed reconnect first.
    const slack = await SlackUserClient.forUser(cfg.slack, cfg.db, cfg.box, userId);
    if (slack) builtin.push(...slackTools(async () => slack));
  }
  if (cfg.github) {
    const gh = await GitHubClient.forUser(cfg.github, cfg.db, cfg.box, userId);
    if (gh) builtin.push(...githubTools(async () => gh));
  }
  const registry = new ToolRegistry(builtin);
  for (const tool of await mcp.tools(userId)) {
    if (!registry.get(tool.name)) registry.add(tool);
  }
  return { registry, skills, google, close: () => mcp.close() };
}
