import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, requireSession } from "@/lib/auth/session";
import { revokeAllUserSessions } from "@/lib/auth/session-registry";
import { revokeRealtimeSessions } from "@/lib/realtime/revoke";
import { logEvent } from "@/lib/observability/log";

/**
 * Logout all devices.
 *
 * Both mechanisms move together: the version bump makes every issued JWT stale,
 * and the row updates make the registry state match. Clearing the response
 * cookie only signs out this browser.
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  const userId = session.userId!;

  try {
    await revokeAllUserSessions(userId, "logout_all");
  } catch (error) {
    console.error("[auth/logout-all] revocation failed:", error);
    return NextResponse.json(
      { error: "Could not sign out all devices. Please try again." },
      { status: 503 },
    );
  }

  try {
    await revokeRealtimeSessions({ userId, all: true });
  } catch (error) {
    logEvent("warn", {
      event: "auth.logout_all.realtime_failed",
      userId,
      error,
    });
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response, request.nextUrl.hostname);
  return response;
}
