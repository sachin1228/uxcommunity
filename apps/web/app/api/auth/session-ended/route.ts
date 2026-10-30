import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";

/**
 * Ends a session whose account no longer exists or is blocked.
 *
 * Server components cannot clear cookies, so the dashboard layout redirects
 * here when its liveness read finds a deleted/blocked member. Clearing the
 * cookie before redirecting avoids the middleware bouncing the still-signed
 * cookie from /login back to /dashboard.
 */
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login?session=ended", request.url));
  clearSessionCookie(response, request.nextUrl.hostname);
  return response;
}
