import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, clearSessionCookie } from "@/lib/auth/session";

/** Lightweight Supabase REST check — Edge-compatible, no SDK needed. */
async function fetchUserStatus(
  userId: string
): Promise<{ exists: boolean; is_blocked: boolean }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { exists: true, is_blocked: false }; // fail open if env missing

  try {
    const res = await fetch(
      `${url}/rest/v1/users?select=id,is_blocked&id=eq.${encodeURIComponent(userId)}&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
        // Do not cache — we always want fresh status
        cache: "no-store",
      }
    );
    if (!res.ok) return { exists: true, is_blocked: false }; // fail open on network error
    const rows = (await res.json()) as { id: string; is_blocked: boolean }[];
    if (!rows || rows.length === 0) return { exists: false, is_blocked: false };
    return { exists: true, is_blocked: rows[0].is_blocked };
  } catch {
    return { exists: true, is_blocked: false }; // fail open
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  // Redirect already-authenticated users away from / and /login
  if (pathname === "/" || pathname === "/login") {
    if (session) {
      const url = request.nextUrl.clone();
      url.pathname = session.role === "admin" ? "/admin" : "/dashboard";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Protect /admin/* — must be admin role
  if (pathname.startsWith("/admin")) {
    if (!session || session.role !== "admin") {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  // Protect /dashboard/* — must be authenticated (any role)
  if (pathname.startsWith("/dashboard")) {
    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    // For regular users, verify they still exist and aren't blocked/deleted.
    // Skip this check for admins (they manage other users; their own status
    // isn't affected by the user block/delete actions).
    if (session.role === "user" && session.userId) {
      const { exists, is_blocked } = await fetchUserStatus(session.userId);
      if (!exists || is_blocked) {
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        const response = NextResponse.redirect(url);
        // Clear the stale session cookie so the login page doesn't loop
        clearSessionCookie(response);
        return response;
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/admin/:path*", "/dashboard/:path*"],
};
