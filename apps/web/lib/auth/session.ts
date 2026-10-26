import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "uxcommunity_session";
export const LEGACY_SESSION_COOKIE = "draft_session";
const EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days
const USER_LIVENESS_TTL_MS = 15_000;

interface ActiveUserState {
  is_blocked: boolean;
  verification_status: string | null;
  created_at: string | null;
}

const activeUserChecks = new Map<string, ActiveUserState & { checkedAt: number }>();
const activeUserChecksInFlight = new Map<string, Promise<ActiveUserState>>();

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
 * Reads the liveness + verification row, cached for 15s per isolate.
 *
 * A blocked/deleted user is a 401 on every call, including reads that opted
 * out of the check. Verification is returned rather than enforced here so a
 * route can opt an action out (post likes) without weakening liveness.
 */
async function getActiveUserState(userId: string): Promise<ActiveUserState> {
  const cached = activeUserChecks.get(userId);
  if (cached && Date.now() - cached.checkedAt < USER_LIVENESS_TTL_MS) {
    return cached;
  }

  const pending = activeUserChecksInFlight.get(userId);
  if (pending) return pending;

  const check = (async () => {
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
    if (error || !row || row.is_blocked) {
      activeUserChecks.delete(userId);
      throw new Response(
        JSON.stringify({ error: "Account has been deactivated or deleted." }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const state: ActiveUserState = {
      is_blocked: false,
      verification_status: row.verification_status,
      created_at: row.created_at,
    };
    activeUserChecks.set(userId, { ...state, checkedAt: Date.now() });
    return state;
  })().finally(() => activeUserChecksInFlight.delete(userId));

  activeUserChecksInFlight.set(userId, check);
  return check;
}

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
 * Checks that the user still exists and may perform writes.
 *
 * Verification is enforced here because this is the one DB check every
 * mutating API route runs (directly or through `requireSession`). Reads skip
 * it with `verifyActive: false`; the few writes an unverified account may
 * still make (likes, read markers) opt out explicitly with `allowUnverified`.
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

/** Clear a cached liveness/verification result after a review or account action. */
export function invalidateUserLiveness(userId: string): void {
  activeUserChecks.delete(userId);
  activeUserChecksInFlight.delete(userId);
}

/** Throws a Response if session is missing, role doesn't match, or user is blocked/deleted. */
export async function requireSession(
  role?: "user" | "admin",
  options?: { verifyActive?: boolean; allowUnverified?: boolean },
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

  // For regular users, verify they still exist and aren't blocked in the DB.
  // Admins are not subject to this check (they won't block themselves via the
  // admin panel, and admin account management is handled separately).
  //
  // Read-only routes may pass verifyActive:false to skip the per-request DB
  // round-trip — the signed JWT already proves who they are, and the liveness
  // check is still enforced on every write/mutation path. A blocked user keeps
  // read access for at most their 7-day session, which is acceptable for
  // cutting per-request DB load (a free-tier capacity win).
  if (
    session.role === "user" &&
    session.userId &&
    options?.verifyActive !== false
  ) {
    await assertUserActive(session.userId, {
      allowUnverified: options?.allowUnverified,
    });
  }

  return session;
}
