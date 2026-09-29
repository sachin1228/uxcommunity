import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Lightweight liveness/health endpoint.
 *
 * Returns 200 as soon as the module graph loads. It calls
 * createServiceClient() so the Supabase singleton is initialised and the heavy
 * @supabase/supabase-js module is cached for the isolate that serves the
 * request — it does NOT make a network call to Supabase, just warms the module.
 *
 * No scheduled warm-up is configured, and none is needed: Cloudflare Workers
 * start in single-digit milliseconds (there is no per-request container boot
 * the way a Lambda has), so pinging this on a timer would spend invocations for
 * no measurable latency win. The heavy shared caches live in R2 (see
 * open-next.config.ts), not per-isolate memory, so a cold isolate is already
 * cheap. Use middleware.ts's rate-limit bypass if you wire this to a monitor.
 */
export async function GET() {
  // Initialise the singleton — ensures supabase-js is loaded and the client
  // object is ready. No DB round-trip needed.
  try {
    createServiceClient();
  } catch {
    // Missing env vars in some environments — still return 200 so a health
    // probe does not see a failure (the singleton is only being warmed).
  }

  return NextResponse.json(
    { ok: true, ts: Date.now() },
    {
      status: 200,
      headers: {
        // Never cache — a health probe needs a fresh response each time.
        "Cache-Control": "no-store",
      },
    }
  );
}
