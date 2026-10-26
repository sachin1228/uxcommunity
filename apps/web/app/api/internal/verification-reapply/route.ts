import { NextRequest, NextResponse } from "next/server";
import { runVerificationReapplyEmails } from "@/lib/verification/reapply-emails";

/**
 * Internal endpoint behind the reapply-eligible email.
 *
 * The realtime Worker's every-minute cron POSTs here (see
 * apps/realtime/src/verification-emails.ts), authenticated with the shared
 * API_SECRET. The sent timestamp on each user makes the run idempotent.
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
    const summary = await runVerificationReapplyEmails();
    return NextResponse.json(
      { ok: true, summary },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[verification/reapply] run failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "run failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
