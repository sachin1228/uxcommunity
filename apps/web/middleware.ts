import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
  verifySession,
} from "@/lib/auth/session";
import {
  checkGlobalRequestRateLimit,
  getGlobalRequestKey,
  getRateLimitHeaders,
} from "@/lib/global-request-rate-limit";

function isApiRequest(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function tooManyRequestsResponse(
  request: NextRequest,
  resetAt: number,
  remaining: number
) {
  const headers = getRateLimitHeaders({ remaining, resetAt });

  if (isApiRequest(request.nextUrl.pathname)) {
    return NextResponse.json(
      {
        error: "Too many requests. Please wait a moment and try again.",
      },
      { status: 429, headers }
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/too-many-requests";
  url.search = "";

  return NextResponse.rewrite(url, { status: 429, headers });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let the fallback page render even while the request identity is blocked.
  if (pathname === "/too-many-requests" || pathname === "/api/healthz") {
    return NextResponse.next();
  }

  const token =
    request.cookies.get(SESSION_COOKIE)?.value ??
    request.cookies.get(LEGACY_SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  const globalLimit = await checkGlobalRequestRateLimit(
    getGlobalRequestKey(request, session?.userId)
  );
  if (!globalLimit.success) {
    return tooManyRequestsResponse(
      request,
      globalLimit.resetAt,
      globalLimit.remaining
    );
  }

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

  }

  return NextResponse.next();
}

export const config = {
  // Protect application requests while excluding static assets and HMR.
  matcher: [
    "/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|webmanifest)$).*)",
  ],
};
