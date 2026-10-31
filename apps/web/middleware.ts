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
import {
  isAllowedMutationOrigin,
  shouldRedirectToHttps,
} from "@/lib/security/request-origin";

function isApiRequest(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function cfVisitorScheme(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { scheme?: unknown };
    return typeof parsed.scheme === "string" ? parsed.scheme : null;
  } catch {
    return null;
  }
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
  const requestHost = request.headers.get("host") ?? request.nextUrl.host;

  // The Worker is reachable over HTTP; Cloudflare does not redirect the app
  // subdomain for us. Redirect before any page/API logic so a login or API
  // request can never be served over plaintext. Local development stays HTTP.
  if (
    shouldRedirectToHttps({
      protocol: request.nextUrl.protocol,
      host: requestHost,
      forwardedProto: request.headers.get("x-forwarded-proto"),
      cfVisitorScheme: cfVisitorScheme(request.headers.get("cf-visitor")),
    })
  ) {
    const httpsUrl = new URL(request.url);
    httpsUrl.protocol = "https:";
    httpsUrl.host = requestHost;
    return NextResponse.redirect(httpsUrl, 308);
  }

  // Browser mutations must come from this origin. Native clients and the
  // internal Worker send no Origin header and retain their own auth gates.
  if (
    isApiRequest(pathname) &&
    !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase()) &&
    !isAllowedMutationOrigin({
      origin: request.headers.get("origin"),
      requestHost,
      secFetchSite: request.headers.get("sec-fetch-site"),
    })
  ) {
    return NextResponse.json(
      { error: "Cross-origin request denied." },
      { status: 403 },
    );
  }

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

  // / and /login are deliberately NOT redirected from here. `verifySession`
  // only checks the signature; a revoked token still verifies, so redirecting
  // an apparently-signed-in user to /dashboard would bounce them straight back
  // to /login forever. The root page does the database-backed check instead.
  if (pathname === "/" || pathname === "/login") {
    return NextResponse.next();
  }

  // Protect /admin/* — signature/role prefilter only. The protected layout and
  // every admin route handler perform the registry + admin-epoch check.
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
