import { NextRequest, NextResponse } from "next/server";
import {
  getRawSession,
  clearSessionCookie,
} from "@/lib/auth/session";
import { revokeAuthSession } from "@/lib/auth/session-registry";
import { revokeRealtimeSessions } from "@/lib/realtime/revoke";
import { logEvent } from "@/lib/observability/log";

/**
 * Logout revokes the current registry row before clearing the cookie.
 *
 * The cookie is only a cache of the token; clearing it without the row update
 * would leave a copied JWT valid for the rest of its 7-day life.
 */
export async function POST(request: NextRequest) {
  const session = await getRawSession();
  if (!session) {
    return NextResponse.json({ success: true });
  }

  const revoked = await revokeAuthSession(session.sid, "logout");
  if (!revoked) {
    // Keep the cookie so the caller can retry: clearing it here would hide the
    // fact that the server-side session is still live.
    return NextResponse.json(
      { error: "Could not sign out. Please try again." },
      { status: 503 },
    );
  }

  if (session.role === "user" && session.userId) {
    try {
      await revokeRealtimeSessions({ userId: session.userId, sid: session.sid });
    } catch (error) {
      logEvent("warn", {
        event: "auth.logout.realtime_failed",
        userId: session.userId,
        error,
      });
    }
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response, request.nextUrl.hostname);
  return response;
}
