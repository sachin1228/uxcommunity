import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { isActiveUserRow } from "@/lib/auth/liveness";
import { sessionCookieOptions } from "@/lib/auth/cookie-domain";
import {
  evaluateSession,
  type SessionRegistryRow,
} from "@/lib/auth/session-validity";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "uxcommunity_session";
export const LEGACY_SESSION_COOKIE = "draft_session";
const EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * The JWT is a signed pointer, not the source of truth.
 *
 * `sid` identifies a row in `public.auth_sessions`; `sv` is the user's
 * `session_version` at issue time. A signature-valid token is only accepted
 * while its row is unrevoked, unexpired, and still matches the account's live
 * version. This is what makes logout / reset / block / delete take effect
 * immediately instead of at JWT expiry.
 *
 * Admin tokens have no users row: `adm` is a digest of the current
 * ADMIN_PASSWORD + SESSION_SECRET, so rotating either invalidates every admin
 * token without storing an admin session version anywhere.
 */
export const VERIFICATION_REQUIRED = "verification_required";

export interface SessionPayload {
  userId?: string;
  email: string;
  role: "user" | "admin";
  sid: string;
  /** User session version. Absent on admin tokens. */
  sv?: number;
  /** Admin epoch digest. Absent on user tokens. */
  adm?: string;
}

export interface ActiveUserState {
  id: string;
  is_blocked: boolean;
  suspended_until?: string | null;
  verification_status: string | null;
  created_at: string | null;
  session_version: number;
}

export interface SessionContext {
  session: SessionPayload;
  /** Live account row for user tokens; null for admin tokens. */
  user: ActiveUserState | null;
}

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function createSession(payload: SessionPayload): Promise<string> {
  if (!payload.sid) {
    throw new Error("createSession requires a registry session id");
  }
  if (payload.role === "user" && (!payload.userId || typeof payload.sv !== "number")) {
    throw new Error("user sessions require userId and session version");
  }
  if (payload.role === "admin" && typeof payload.adm !== "string") {
    throw new Error("admin sessions require an admin epoch");
  }

  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${EXPIRY_SECONDS}s`)
    .sign(secretKey());
}

/**
 * Verify signature and required claims only. Database-backed revocation is
 * applied by `getSessionContext` / `requireSession`; middleware uses this fast
 * check to avoid a database round trip on every static request.
 *
 * Tokens issued before the session registry (no `sid`/`sv`/`adm`) are rejected.
 */
export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());

    if (typeof payload.sid !== "string" || !payload.sid) return null;
    if (payload.role !== "user" && payload.role !== "admin") return null;
    if (typeof payload.email !== "string") return null;

    if (payload.role === "user") {
      if (typeof payload.userId !== "string" || !payload.userId) return null;
      if (typeof payload.sv !== "number") return null;
    } else if (typeof payload.adm !== "string" || !payload.adm) {
      return null;
    }

    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Read the raw signed session without the registry lookup. Only logout and
 * account-deletion need the sid before revoking it; every authorization path
 * must use `getSessionContext` / `requireSession`.
 */
export const getRawSession = cache(async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  const token =
    store.get(SESSION_COOKIE)?.value ??
    store.get(LEGACY_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
});

let adminEpochCache: { key: string; value: string } | null = null;

/**
 * Digest of the current admin credential. Cached per isolate process and keyed
 * by the secret values, so an old admin JWT stops matching as soon as the
 * environment is redeployed with a rotated ADMIN_PASSWORD or SESSION_SECRET.
 */
export async function getAdminEpoch(): Promise<string | null> {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret) return null;

  const key = `${secret}\u0000${password}`;
  if (adminEpochCache?.key === key) return adminEpochCache.value;

  const bytes = new TextEncoder().encode(`uxcommunity-admin\u0000${key}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  const value = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  adminEpochCache = { key, value };
  return value;
}

interface RegistryUserRow {
  id: string;
  is_blocked: boolean;
  suspended_until?: string | null;
  session_version: number;
  verification_status: string | null;
  created_at: string | null;
}

/**
 * Validate a signature-valid payload against the registry and live account.
 *
 * Fails closed on every database error. The embedded users join gives us the
 * liveness check in the same round trip, so this remains one query per request
 * (deduplicated by React cache across the whole RSC/route request).
 */
export async function validateSessionPayload(
  session: SessionPayload,
  options?: { allowBlocked?: boolean },
): Promise<SessionContext | null> {
  try {
    // Lazy import keeps JWT-only consumers edge-compatible.
    const { createServiceClient } = await import("@/lib/supabase/service");
    const db = createServiceClient();

    const { data, error } = await db
      .from("auth_sessions")
      .select(
        "id, user_id, role, session_version, revoked_at, expires_at, users!auth_sessions_user_id_fkey(id, is_blocked, suspended_until, session_version, verification_status, created_at)",
      )
      .eq("id", session.sid)
      .maybeSingle();

    if (error) {
      console.error("[session] registry lookup failed:", error.message);
      return null;
    }

    const row = data as unknown as SessionRegistryRow | null;

    const validity = evaluateSession(row, session, {
      adminEpoch: session.role === "admin" ? await getAdminEpoch() : null,
      allowBlocked: options?.allowBlocked,
    });
    if (!validity.active) return null;

    if (!validity.user) return { session, user: null };

    const verification = row?.users as unknown as
      | RegistryUserRow
      | RegistryUserRow[]
      | null;
    const details = Array.isArray(verification)
      ? (verification[0] ?? null)
      : verification;

    return {
      session,
      user: {
        id: validity.user.id,
        is_blocked: validity.user.is_blocked,
        suspended_until: validity.user.suspended_until ?? null,
        verification_status: details?.verification_status ?? null,
        created_at: details?.created_at ?? null,
        session_version: validity.user.session_version,
      },
    };
  } catch (err) {
    console.error("[session] registry validation failed:", err);
    return null;
  }
}

/**
 * Full session read: signature + registry row + live account. Cached per
 * request only. This is the authorization primitive; nothing else should treat
 * `verifySession` as proof of an active session.
 */
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const session = await getRawSession();
    if (!session) return null;
    return validateSessionPayload(session);
  },
);

/**
 * Read the current session from server-side cookies (App Router).
 * Returns null when the token is revoked, expired, or the account is gone.
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const context = await getSessionContext();
  return context?.session ?? null;
});

/**
 * Signature- and registry-valid session that still permits a blocked account.
 * Used only by account erasure: a suspended member must retain the ability to
 * delete their own account, while every other guarded surface uses
 * `getSession` / `requireSession`.
 */
export const getSessionForErasure = cache(
  async (): Promise<SessionPayload | null> => {
    const session = await getRawSession();
    if (!session) return null;
    const context = await validateSessionPayload(session, { allowBlocked: true });
    return context?.session ?? null;
  },
);

/**
 * The session cookie must also reach the realtime service, which runs on a
 * sibling subdomain (rt.uxcommunity.in), so the WebSocket handshake can carry
 * the JWT cross-subdomain. `sessionCookieOptions` owns the pure host/domain
 * decision; it is unit-tested without Next/React.
 */
export function setSessionCookie(res: NextResponse, token: string, host?: string) {
  res.cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions({
      host,
      appUrl: process.env.NEXT_PUBLIC_APP_URL,
      secure: process.env.NODE_ENV === "production",
      maxAge: EXPIRY_SECONDS,
    }),
  );
}

export function clearSessionCookie(res: NextResponse, host?: string) {
  for (const cookieName of [SESSION_COOKIE, LEGACY_SESSION_COOKIE]) {
    res.cookies.set(
      cookieName,
      "",
      sessionCookieOptions({
        host,
        appUrl: process.env.NEXT_PUBLIC_APP_URL,
        secure: process.env.NODE_ENV === "production",
        maxAge: 0,
      }),
    );
  }
}

/**
 * Reads the liveness + verification row for callers that only have a userId.
 * `getSessionContext` normally already embeds this row, so `requireSession`
 * does not issue a second query.
 */
const getActiveUserState = cache(async (userId: string): Promise<ActiveUserState> => {
  // Lazy import keeps JWT-only consumers edge-compatible.
  const { createServiceClient } = await import("@/lib/supabase/service");
  const db = createServiceClient();
  const { data, error } = await db
    .from("users")
    .select("id, is_blocked, suspended_until, session_version, verification_status, created_at")
    .eq("id", userId)
    .maybeSingle();

  const row = data as RegistryUserRow | null;
  if (error || !isActiveUserRow(row)) {
    throw new Response(
      JSON.stringify({ error: "Account has been deactivated or deleted." }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  return {
    id: row.id,
    is_blocked: false,
    suspended_until: row.suspended_until ?? null,
    verification_status: row.verification_status,
    created_at: row.created_at,
    session_version: row.session_version,
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

async function assertUserState(
  state: ActiveUserState,
  options?: { allowUnverified?: boolean },
): Promise<void> {
  // Product policy: until approval, the account is read-only apart from the
  // explicitly-opted-in actions (browsing, likes, reporting, account and
  // verification management, account deletion). The old grace window is
  // deliberately not consulted here: it let an unapproved account post/chat
  // for two days, which contradicted the banner and Terms and defeated the
  // verification gate as a spam control. `verification_settings.grace_days`
  // remains for display/legacy only.
  if (state.verification_status === "approved" || options?.allowUnverified) {
    return;
  }
  throw verificationRequiredResponse(state.verification_status);
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
  await assertUserState(state, options);
}

/** Throws a Response if session is missing, role doesn't match, or user is blocked/deleted/revoked. */
export async function requireSession(
  role?: "user" | "admin",
  options?: { allowUnverified?: boolean },
): Promise<SessionPayload> {
  const context = await getSessionContext();
  if (!context) {
    throw new Response(
      JSON.stringify({ error: "Unauthorized", code: "session_revoked" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const { session } = context;
  if (role && session.role !== role) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (session.role === "user") {
    if (!context.user) {
      throw new Response(
        JSON.stringify({ error: "Unauthorized", code: "session_revoked" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    await assertUserState(context.user, {
      allowUnverified: options?.allowUnverified,
    });
  }

  return session;
}
