import { createClient } from "@supabase/supabase-js";

/**
 * Singleton Supabase browser client.
 * Uses the anon (public) key — safe for client components.
 * Only needed for Realtime subscriptions; all data writes go through
 * Next.js API routes that use the service-role client.
 */
let _client: ReturnType<typeof createClient> | null = null;

export function createBrowserClient() {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  return _client;
}
