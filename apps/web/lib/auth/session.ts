import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { isActiveUserRow } from "@/lib/auth/liveness";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "uxcommunity_session";
export const LEGACY_SESSION_COOKIE = "draft_session";
const EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days

interface ActiveUserState {
  is_blocked: boolean;
  verification_status: string | null;
  created_at: string | null;
}

/** Machine-readable code so clients can open the verification flow. */
export const VERIFICATION_REQUIRED = "verification_required";

export interface SessionPayload {
  userId?: string;
  email: string;
  role: "user" | "admin";
}

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function createSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${EXPIRY_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Read the current session from server-side cookies (App Router).
 * React cache deduplicates nested layout/page reads within one RSC request
 * without sharing cookie-derived state between users or requests.
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  const token =
    store.get(SESSION_COOKIE)?.value ??
    store.get(LEGACY_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
});

/**
 * The session cookie must also reach the realtime service, which runs on a
 * sibling subdomain (rt.uxcommunity.in), so the WebSocket handshake can carry
 * the JWT cross-subdomain. Scope it to the registrable domain. Localhost (dev)
 * and any other host stays host-only.
 */
function cookieDomain(host?: string): string | undefined {
  const isAppHost = (h: string) =>
    h === "uxcommunity.in" || h.endsWith(".uxcommunity.in");
  const requestHost = host?.split(":")[0].toLowerCase();

  if (requestHost && isAppHost(requestHost)) return ".uxcommunity.in";

  // A localhost / loopback request must stay host-only — never let the
  // production env domain override it during local preview.
  if (
    requestHost &&
    (requestHost === "localhost" ||
      requestHost.endsWith(".local") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(requestHost))
  ) {
    return undefined;
  }

  // OpenNext can present the worker's own hostname (e.g. *.workers.dev) to
  // route handlers. Fall back to the env-derived app host when the request
  // host doesn't already identify the app domain.
  const envHost = appUrlHost();
  return envHost && isAppHost(envHost) ? ".uxcommunity.in" : undefined;
}

/** Fallback host derived from NEXT_PUBLIC_APP_URL (set in the prod build). */
function appUrlHost(): string | undefined {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return undefined;
  try {
    return new URL(appUrl).hostname;
  } catch {
    return undefined;
  }
}

export function setSessionCookie(res: NextResponse, token: string, host?: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: EXPIRY_SECONDS,
    path: "/",
    ...(cookieDomain(host) ? { domain: cookieDomain(host)! } : {}),
  });
}

export function clearSessionCookie(res: NextResponse, host?: string) {
  for (const cookieName of [SESSION_COOKIE, LEGACY_SESSION_COOKIE]) {
    res.cookies.set(cookieName, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
      ...(cookieDomain(host) ? { domain: cookieDomain(host)! } : {}),
    });
  }
}

/**
 * Reads the liveness + verification row.
 *
 * Every request re-reads it: a deleted or blocked account must lose access at
 * its next call, not when its 7-day JWT expires. `cache` only deduplicates
 * repeated calls within one request; nothing is shared between requests or
 * isolates, so deletion takes effect everywhere immediately.
 */
const getActiveUserState = cache(async (userId: string): Promise<ActiveUserState> => {
  // Lazy import keeps JWT-only consumers edge-compatible.
  const { createServiceClient } = await import("@/lib/supabase/service");
  const db = createServiceClient();
  const { data, error } = await db
    .from("users")
    .select("id, is_blocked, verification_status, created_at")
    .eq("id", userId)
    .maybeSingle();

  const row = data as {
    id: string;
    is_blocked: boolean;
    verification_status: string | null;
    created_at: string | null;
  } | null;
  if (error || !isActiveUserRow(row)) {
    throw new Response(
      JSON.stringify({ error: "Account has been deactivated or deleted." }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  return {
    is_blocked: false,
    verification_status: row.verification_status,
    created_at: row.created_at,
  };
});

function verificationRequiredResponse(status: string | null): Response {
  return new Response(
    JSON.stringify({
      error: "Your account is read-only until verification is approved.",
      code: VERIFICATION_REQUIRED,
      verification_status: status ?? "unverified",
    }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Checks that the user still exists and may use the API.
 *
 * Liveness (deleted/blocked) is enforced on every request; verification is
 * enforced on writes, while the few actions an unverified account may still
 * take (likes, read markers) opt out explicitly with `allowUnverified`.
 */
export async function assertUserActive(
  userId: string,
  options?: { allowUnverified?: boolean },
): Promise<void> {
  const state = await getActiveUserState(userId);
  if (state.verification_status === "approved" || options?.allowUnverified) {
    return;
  }

  // New signups get a short, admin-configured grace window before the gate
  // applies. Lazy import keeps this module edge-compatible.
  const { getVerificationGraceDays, isVerificationRestricted } = await import(
    "@/lib/verification/settings"
  );
  const graceDays = await getVerificationGraceDays();
  const restricted = isVerificationRestricted({
    status: state.verification_status,
    createdAt: state.created_at,
    graceDays,
  });
  if (restricted) {
    throw verificationRequiredResponse(state.verification_status);
  }
}

/** Throws a Response if session is missing, role doesn't match, or user is blocked/deleted. */
export async function requireSession(
  role?: "user" | "admin",
  options?: { allowUnverified?: boolean },
): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (role && session.role !== role) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // For regular users, verify on every request that the account still exists
  // and is not blocked. Admins are not subject to this check (the admin
  // credential has no users row; admin access is managed separately).
  if (session.role === "user" && session.userId) {
    await assertUserActive(session.userId, {
      allowUnverified: options?.allowUnverified,
    });
  }

  return session;
}
