import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Singleton browser client — reuse across components
let _client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabase() {
  if (!_client) {
    _client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  return _client;
}

export const supabase = getSupabase();
