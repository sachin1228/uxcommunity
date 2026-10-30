import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, requireSession } from "@/lib/auth/session";
import { revokeAllAdminSessions } from "@/lib/auth/session-registry";

/**
 * Admin logout-all. Admin tokens share one epoch (there is no per-admin user
 * id), so selective revocation is only possible by deleting their registry
 * rows. Rotating ADMIN_PASSWORD invalidates all admin tokens independently of
 * this endpoint.
 */
export async function POST(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  try {
    await revokeAllAdminSessions("admin_logout_all");
  } catch (error) {
    console.error("[admin/logout-all] revocation failed:", error);
    return NextResponse.json(
      { error: "Could not revoke admin sessions. Please try again." },
      { status: 503 },
    );
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response, request.nextUrl.hostname);
  return response;
}
