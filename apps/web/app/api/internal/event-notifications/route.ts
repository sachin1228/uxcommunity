import { NextRequest, NextResponse } from "next/server";
import { runEventLifecycleNotifications } from "@/lib/events/lifecycle-notifications";

/**
 * Internal endpoint behind event lifecycle notifications.
 *
 * The realtime Worker's every-minute cron POSTs here (see
 * apps/realtime/src/event-notifications.ts); nothing here is reachable from a
 * browser session. Authentication mirrors the other server-to-server endpoints
 * the Worker calls: a bearer API_SECRET, the same value in both Workers.
 *
 * A run is idempotent by construction — the delivery ledger claims each
 * (event, stage, member) before anything is sent — so a retried or overlapping
 * tick cannot double-notify. The summary is logged by the Worker as one
 * structured line; `complete: false` means the budget cut the run short and the
 * next tick continues.
 */
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const apiSecret = process.env.API_SECRET;
  if (!apiSecret) return false;
  return req.headers.get("authorization") === `Bearer ${apiSecret}`;
}

export async function POST(req: NextRequest) {
  if (!process.env.API_SECRET) {
    return NextResponse.json({ ok: false, error: "API_SECRET not configured" }, { status: 500 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runEventLifecycleNotifications();
    return NextResponse.json(
      { ok: true, summary },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[event-lifecycle] run failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "run failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
