import { createClient } from "@/lib/supabase/client";

/**
 * Backwards-compatible alias for Realtime consumers. Auth and Realtime now
 * share the same singleton client, avoiding duplicate GoTrue instances.
 */
export function createBrowserClient() {
  return createClient();
}
