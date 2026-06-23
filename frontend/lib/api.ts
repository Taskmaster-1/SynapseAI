import { supabase } from "./supabase";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

async function request(path: string, options: RequestInit = {}) {
  const { data }: { data: { session: any } } = await supabase.auth.getSession();
  const session = data.session;
  const headers = {
    "Content-Type": "application/json",
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || "Request failed");
  }
  return response.status === 204 ? null : response.json();
}

export interface UserPreferences {
  agent_tone: "professional" | "casual" | "concise" | "detailed";
  agent_instructions: string | null;
  timezone: string;
  confirm_before_send: boolean;
  auto_execute_safe_tools: boolean;
  daily_digest_enabled: boolean;
  daily_digest_time: string;
  email_notifications: boolean;
}

export const preferencesApi = {
  get: () => request("/user/preferences"),
  update: (data: Partial<UserPreferences>) => request("/user/preferences", {
    method: "PATCH",
    body: JSON.stringify(data),
  }),
};

export interface UsageSummary {
  total_messages: number;
  total_agent_turns: number;
  tool_call_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
  most_used_tools: { name: string; count: number }[];
}

export interface DailyUsage {
  date: string;
  tokens: number;
}

export const analyticsApi = {
  usage: (period: string) => request(`/analytics/usage?period=${period}`),
  timeline: (days: number) => request(`/analytics/timeline?days=${days}`),
};
