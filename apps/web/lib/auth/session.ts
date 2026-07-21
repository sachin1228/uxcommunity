import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export const SESSION_COOKIE = "draft_session";
const EXPIRY_SECONDS = 60 * 60 * 24 * 7; // 7 days

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

/** Read the current session from server-side cookies (App Router). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export function setSessionCookie(res: NextResponse, token: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: EXPIRY_SECONDS,
    path: "/",
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

/**
 * Checks the DB to confirm the user still exists and isn't blocked.
 * Used in API routes to guard against deleted/blocked users who still hold
 * a valid JWT (sessions are stateless, so we must verify liveness explicitly).
 */
async function assertUserActive(userId: string): Promise<void> {
  // Lazy import to keep the session module edge-compatible when only the
  // JWT helpers are used (e.g. in middleware).
  const { createServiceClient } = await import("@/lib/supabase/service");
  const db = createServiceClient();
  const { data } = await db
    .from("users")
    .select("id, is_blocked")
    .eq("id", userId)
    .maybeSingle();

  if (!data || data.is_blocked) {
    throw new Response(
      JSON.stringify({ error: "Account has been deactivated or deleted." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
}

/** Throws a Response if session is missing, role doesn't match, or user is blocked/deleted. */
export async function requireSession(
  role?: "user" | "admin"
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
  if (session.role === "user" && session.userId) {
    await assertUserActive(session.userId);
  }

  return session;
}
