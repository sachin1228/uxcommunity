import { NextRequest, NextResponse } from "next/server";
import { alertAdmins } from "@/lib/health/alert";
import { checkDependencies } from "@/lib/health/dependencies";

/**
 * Internal endpoint for the scheduled dependency monitor.
 *
 *   GET  → the current report (the monitor reads status from it)
 *   POST → re-run the checks and email the admins, then return the report
 *
 * Authentication mirrors the other server-to-server endpoint the realtime
 * worker calls (app/api/communities/[id]/members/[userId]/check): a bearer
 * API_SECRET, the same value in both Workers. Nothing here is reachable from a
 * browser session and nothing is cached — a stale health report is worse than
 * none.
 *
 * WHY THE MONITOR DOES NOT EMAIL DIRECTLY
 *   The decision of WHEN to alert (a new outage, a reminder while it lasts, a
 *   recovery) belongs to the monitor, which keeps that state durably. The
 *   decision of WHAT an alert says and who gets it belongs here, next to the
 *   Resend key, the email templates and ADMIN_EMAIL — so there is exactly one
 *   implementation of an alert email and the realtime Worker needs no email
 *   credential at all.
 *
 * The POST body may say which kind of alert to send:
 *   { "kind": "down" }                    — the default
 *   { "kind": "recovered", "ids": [...] } — what the monitor says was down, so
 *                                            the email can name exactly that
 */
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const apiSecret = process.env.API_SECRET;
  if (!apiSecret) return false;
  return req.headers.get("authorization") === `Bearer ${apiSecret}`;
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!process.env.API_SECRET) {
    return NextResponse.json({ ok: false, error: "API_SECRET not configured" }, { status: 500 });
  }
  if (!authorized(req)) return unauthorized();

  const report = await checkDependencies();
  return NextResponse.json(
    { ok: true, report },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  if (!process.env.API_SECRET) {
    return NextResponse.json({ ok: false, error: "API_SECRET not configured" }, { status: 500 });
  }
  if (!authorized(req)) return unauthorized();

  let kind: "down" | "recovered" = "down";
  let ids: string[] | undefined;
  try {
    const body = (await req.json()) as { kind?: unknown; ids?: unknown };
    if (body?.kind === "recovered") kind = "recovered";
    if (Array.isArray(body?.ids)) {
      ids = body.ids.filter((value): value is string => typeof value === "string");
    }
  } catch {
    // No body (or a malformed one) means the default alert. The monitor's own
    // decision is the important part; a body that will not parse is not worth
    // failing the alert over.
  }

  // Re-run the checks rather than trusting a report from the caller: the email
  // must describe what is true now, and this endpoint is the only writer.
  const report = await checkDependencies();
  const outcome = await alertAdmins(report, { kind, ids });

  return NextResponse.json(
    { ok: true, alerted: outcome, report },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
