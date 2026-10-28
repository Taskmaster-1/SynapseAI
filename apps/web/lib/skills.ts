/** Skills API (see docs/skills.md). Kept beside lib/api.ts, on the same `request` helper. */
import { request } from "@/lib/api";

export interface SkillSummary {
  name: string;
  description: string;
  source: "builtin" | "user";
  enabled: boolean;
  /** Content hash; changes whenever anything the agent can read changes. */
  version: string;
  /** Reference file paths. */
  files: string[];
  updatedAt: string | null;
}

export interface SkillDetail extends SkillSummary {
  body: string;
  fileContents: Record<string, string>;
}

export interface SkillInput {
  name: string;
  description: string;
  body: string;
  enabled?: boolean;
}

const enc = encodeURIComponent;

export const skillsApi = {
  list: () => request<{ skills: SkillSummary[] }>("GET", "/api/skills"),
  get: (name: string) => request<{ skill: SkillDetail }>("GET", `/api/skills/${enc(name)}`),
  create: (body: SkillInput) => request<{ skill: SkillDetail }>("POST", "/api/skills", body),
  /** Imports a SKILL.md as it is. */
  importMarkdown: (markdown: string) =>
    request<{ skill: SkillDetail }>("POST", "/api/skills", { markdown }),
  update: (name: string, body: Partial<SkillInput>) =>
    request<{ skill: SkillDetail }>("PATCH", `/api/skills/${enc(name)}`, body),
  remove: (name: string) => request<void>("DELETE", `/api/skills/${enc(name)}`),
  markdownUrl: (name: string) => `/api/skills/${enc(name)}/markdown`,
};
