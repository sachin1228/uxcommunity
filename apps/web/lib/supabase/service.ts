import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** Service-role client typed with the generated database schema. */
export type ServiceClient = SupabaseClient<Database>;

/**
 * Service-role Supabase client.
 * Bypasses Row Level Security — use ONLY on the server.
 * Never import this in Client Components.
 *
 * Module-level singleton: reused across warm serverless invocations so we
 * don't pay client-construction overhead on every request.
 *
 * The generated `Database` type is passed explicitly. Without it the
 * `Schema` generic of `SupabaseClient` collapses to `never`, which made every
 * `.from(...)`/`.update(...)` call in the codebase typecheck as `never`.
 */
let _client: ServiceClient | null = null;

export function createServiceClient() {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
    );
  }

  _client = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });

  return _client;
}
