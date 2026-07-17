import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client.
 * Bypasses Row Level Security — use ONLY on the server.
 * Never import this in Client Components.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
