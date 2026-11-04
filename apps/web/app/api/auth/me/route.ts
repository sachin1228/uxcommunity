import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  clearSessionCookie,
  createSession,
  setSessionCookie,
  type SessionPayload,
} from "@/lib/auth/session";
import { extendAuthSession } from "@/lib/auth/session-registry";
import {
  USER_SESSION_EXPIRY_SECONDS,
  shouldRenewSession,
} from "@/lib/auth/session-lifetime";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getRequestClientIp } from "@/lib/global-request-rate-limit";
import {
  getNewAccountGraceDays,
  isVerificationBannerVisible,
} from "@/lib/verification/settings";

/**
 * Sliding member sessions: once the token is inside its final month, extend the
 * registry row and hand back a freshly signed token. Mobile and web both call
 * this route on launch/foreground, so an active member is never signed out by
 * the clock.
 */
async function renewSessionIfExpiring(session: SessionPayload): Promise<string | null> {
  const now = Date.now();
  if (!shouldRenewSession(session.exp, Math.floor(now / 1000))) return null;

  const expiresAt = new Date(now + USER_SESSION_EXPIRY_SECONDS * 1000).toISOString();
  if (!(await extendAuthSession(session.sid, expiresAt))) return null;

  try {
    return await createSession({
      userId: session.userId!,
      email: session.email,
      role: "user",
      sid: session.sid,
      sv: session.sv!,
    });
  } catch (error) {
    console.error("[auth/me] session renewal failed:", error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  // L-7: Rate-limit /me to prevent aggressive polling from hammering the DB
  const ip = getRequestClientIp(request);
  const rl = await rateLimit(`me:ip:${ip}`, 60, 60); // 60 per minute per IP
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  if (session.role === "admin") {
    return NextResponse.json({ user: { role: "admin", email: session.email } });
  }

  const db = createServiceClient();
  // The user row and its 1:1 profile are keyed by the same session id, so all
  // three reads leave in one round trip instead of stacking the profile and
  // grace lookup behind the users select.
  const [{ data: user }, { data: profile }, graceDays] = await Promise.all([
    db
      .from("users")
      .select(
        "id, name, email, created_at, verification_status, verification_reapply_at, verification_rejection_reason, email_verified_at",
      )
      .eq("id", session.userId!)
      .maybeSingle(),
    db
      .from("designer_profiles")
      .select("id, avatar_url")
      .eq("user_id", session.userId!)
      .maybeSingle(),
    getNewAccountGraceDays(),
  ]);

  if (!user) {
    // M-5: User row was deleted — clear the stale cookie so the client
    // doesn't stay stuck in a logged-in-but-no-user state.
    const response = NextResponse.json({ user: null });
    clearSessionCookie(response, request.nextUrl.hostname);
    return response;
  }

  const verificationStatus =
    (user as { verification_status?: string }).verification_status ?? "unverified";
  const verificationBannerVisible = isVerificationBannerVisible({
    status: verificationStatus,
    createdAt: (user as { created_at?: string | null }).created_at ?? null,
    graceDays,
  });

  const response = NextResponse.json({
    user: {
      ...user,
      role: "user",
      profileComplete: !!profile,
      avatar_url: (profile as { avatar_url?: string | null } | null)?.avatar_url ?? null,
      verificationStatus,
      verificationBannerVisible,
      verificationReapplyAt:
        (user as { verification_reapply_at?: string | null }).verification_reapply_at ?? null,
      verificationRejectionReason:
        (user as { verification_rejection_reason?: string | null }).verification_rejection_reason ?? null,
      emailVerifiedAt: (user as { email_verified_at?: string | null }).email_verified_at ?? null,
    },
  });

  response.headers.set("Cache-Control", "no-store");
  const renewedToken = await renewSessionIfExpiring(session);
  if (renewedToken) setSessionCookie(response, renewedToken, request.nextUrl.hostname);
  return response;
}
