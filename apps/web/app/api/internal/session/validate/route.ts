import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  evaluateSession,
  type SessionRegistryRow,
} from "@/lib/auth/session-validity";

export const dynamic = "force-dynamic";

/**
 * Internal session validation for the realtime Worker.
 *
 * A WebSocket handshake is authenticated twice: the Worker verifies the JWT
 * signature locally, then asks this endpoint whether the `sid`/`sv` pair is
 * still live. It is deliberately not a browser endpoint: without API_SECRET it
 * answers 401, so possession of a stolen JWT alone cannot make it disclose
 * account state.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.API_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!process.env.API_SECRET) {
    return NextResponse.json(
      { ok: false, error: "API_SECRET not configured" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: { sid?: unknown; sv?: unknown; userId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { sid, sv, userId } = body;
  if (
    typeof sid !== "string" ||
    !sid ||
    typeof sv !== "number" ||
    typeof userId !== "string" ||
    !userId
  ) {
    return NextResponse.json(
      { ok: false, error: "missing_claims" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("auth_sessions")
      .select(
        "id, user_id, role, session_version, revoked_at, expires_at, users!auth_sessions_user_id_fkey(id, is_blocked, suspended_until, session_version)",
      )
      .eq("id", sid)
      .maybeSingle();

    if (error) {
      console.error("[internal/session/validate] lookup failed:", error.message);
      return NextResponse.json(
        { ok: false, error: "unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const validity = evaluateSession(
      data as unknown as SessionRegistryRow | null,
      { userId, role: "user", sv },
      { adminEpoch: null },
    );

    if (!validity.active) {
      return NextResponse.json(
        { ok: false },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { ok: true, userId, sessionVersion: sv },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[internal/session/validate] error:", error);
    return NextResponse.json(
      { ok: false, error: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
