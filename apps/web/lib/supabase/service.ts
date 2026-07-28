import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client.
 * Bypasses Row Level Security — use ONLY on the server.
 * Never import this in Client Components.
 *
 * Module-level singleton: reused across warm serverless invocations so we
 * don't pay client-construction overhead on every request.
 */
let _client: ReturnType<typeof createClient> | null = null;

export function createServiceClient() {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
  });

  return _client;
}
