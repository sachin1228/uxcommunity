import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { secureEqual } from "@/lib/auth/secure-compare";
import { processDueMembershipRevocations } from "@/lib/realtime/membership-revocation-queue";

export const dynamic = "force-dynamic";

/**
 * Internal, secret-authenticated queue drain for membership revocations.
 *
 * The realtime Worker's minute cron calls this after a removal could not close
 * the member's sockets immediately. It is never reachable by a browser or
 * mobile client: without API_SECRET it answers 401, and the route is outside
 * every user-facing route tree.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.API_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "API_SECRET not configured" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!secureEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const summary = await processDueMembershipRevocations(createServiceClient(), {
      limit: 5,
    });
    return NextResponse.json(
      { ok: true, ...summary },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[internal/membership-revocations] drain failed", error);
    return NextResponse.json(
      { ok: false, error: "drain failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
