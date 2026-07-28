import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Lightweight keep-warm endpoint.
 *
 * Vercel Cron (vercel.json) pings this every minute so the Lambda container
 * stays alive and the module graph (supabase-js, jose, etc.) stays loaded.
 * This cuts the cold-start penalty from ~2-4 s down to near zero for the
 * first real request after a quiet period.
 *
 * The endpoint intentionally calls createServiceClient() so the singleton
 * is initialised and the heavy @supabase/supabase-js module is cached.
 * It does NOT make a network call to Supabase — just warms the module.
 */
export async function GET() {
  // Initialise the singleton — ensures supabase-js is loaded and the client
  // object is ready. No DB round-trip needed.
  try {
    createServiceClient();
  } catch {
    // Missing env vars in some environments — still return 200 so the cron
    // doesn't get marked as failing and start backing off.
  }

  return NextResponse.json(
    { ok: true, ts: Date.now() },
    {
      status: 200,
      headers: {
        // Never cache — cron needs a fresh response each time.
        "Cache-Control": "no-store",
      },
    }
  );
}
