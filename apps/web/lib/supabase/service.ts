import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Service-role Supabase client.
 * Bypasses Row Level Security — use ONLY on the server.
 * Never import this in Client Components.
 *
 * Typed with the generated schema from `lib/supabase/database.types.ts`
 * (regenerate with `npm run db:types` after a migration). This generic is
 * load-bearing: without it supabase-js cannot infer what a query returns and
 * every `.select()` result collapses to `never`.
 *
 * Module-level singleton: reused across warm serverless invocations so we
 * don't pay client-construction overhead on every request.
 */
type ServiceClient = SupabaseClient<Database>;

let _client: ServiceClient | null = null;

export function createServiceClient(): ServiceClient {
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
