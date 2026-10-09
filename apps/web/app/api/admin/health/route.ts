import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { checkDependencies } from "@/lib/health/dependencies";

/**
 * Reachability of R2, Supabase and the realtime Worker, for the admin page at
 * apps/web/app/admin/(protected)/health.
 *
 * Admin-only, and never cached: the answer is only worth reading when it was
 * measured now. A dependency that is down makes this route answer 503 while
 * still returning the full report, so an uptime monitor can watch the status
 * code alone and the page can render the detail either way.
 *
 * The checks are read-only (see lib/health/dependencies.ts) — pressing
 * "re-check" never writes to storage, publishes to a room, or changes a row.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const report = await checkDependencies();

  return NextResponse.json(report, {
    status: report.healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
