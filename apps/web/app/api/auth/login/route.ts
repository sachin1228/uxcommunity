import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createServiceClient } from "@/lib/supabase/service";
import { loginSchema } from "@/lib/validations";
import { createSession, getAdminEpoch, setSessionCookie } from "@/lib/auth/session";
import {
  AccountUnavailableError,
  createAuthSession,
  createLoginSession,
  PasswordChangedError,
} from "@/lib/auth/session-registry";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getRequestClientIp } from "@/lib/global-request-rate-limit";
import { hashPassword, needsPasswordRehash } from "@/lib/auth/password";
import { secureEqual } from "@/lib/auth/secure-compare";
import { isSignupIncomplete } from "@/lib/auth/signup-status";
import { createServerTimer, MIDDLEWARE_TIMING_HEADER } from "@/lib/server-timing";
import {
  getNewAccountGraceDays,
  isVerificationBannerVisible,
} from "@/lib/verification/settings";

type LoginUserRow = {
  id: string;
  name: string | null;
  email: string;
  password_hash: string;
  is_blocked: boolean;
  verification_status: string;
  verification_reapply_at: string | null;
  verification_rejection_reason: string | null;
  created_at: string;
  designer_profiles: { id: string; avatar_url: string | null } | null;
};

export async function POST(request: NextRequest) {
  const timer = createServerTimer("POST /api/auth/login");
  try {
    const response = await login(request, timer);
    response.headers.set("Server-Timing", [
      request.headers.get(MIDDLEWARE_TIMING_HEADER),
      timer.finish({ status: response.status }),
    ].filter(Boolean).join(", "));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    timer.finish({ status: 500 });
    throw error;
  }
}

async function login(request: NextRequest, timer: ReturnType<typeof createServerTimer>) {
  const ip = getRequestClientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  // IP-level gate (10 per 15 min per IP) and per-account gate (20 per 15 min
  // per account) run concurrently — both were previously awaited sequentially,
  // adding one extra external Redis round trip to every login attempt.
  const [rlIp, rlEmail] = await timer.measure("login_limits", () => Promise.all([
    rateLimit(`login:ip:${ip}`, 10, 900),
    rateLimit(`login:email:${normalizedEmail}`, 20, 900),
  ]));
  if (!rlIp.success) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rlIp.resetAt - Date.now()) / 1000)) },
      }
    );
  }
  if (!rlEmail.success) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rlEmail.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  // ── Admin short-circuit ──────────────────────────────────────────────
  const adminEmail    = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (
    adminEmail && adminPassword &&
    secureEqual(email.toLowerCase(), adminEmail.toLowerCase()) &&
    secureEqual(password, adminPassword)
  ) {
    const adm = await getAdminEpoch();
    if (!adm) {
      console.error("[login] admin epoch unavailable");
      return NextResponse.json(
        { error: "Admin sign-in is temporarily unavailable." },
        { status: 500 },
      );
    }

    try {
      const { sessionId } = await timer.measure("session_create", () => createAuthSession({
        role: "admin",
        userAgent: request.headers.get("user-agent"),
      }));
      const token = await timer.measure("sign", () => createSession({
        email: adminEmail,
        role: "admin",
        sid: sessionId,
        adm,
      }));
      const response = NextResponse.json({ success: true, redirect: "/admin" });
      setSessionCookie(response, token, request.nextUrl.hostname);
      return response;
    } catch (err) {
      console.error("[login] admin session creation failed:", err);
      return NextResponse.json(
        { error: "Admin sign-in is temporarily unavailable." },
        { status: 500 },
      );
    }
  }

  const db = createServiceClient();

  // Single round trip: the users row plus its (1:1) designer profile, embedded
  // through the FK. The !user_id hint is REQUIRED: in this schema PostgREST can
  // resolve more than one path between users and designer_profiles, and an
  // unhinted embed silently picks one that returns no rows. A missing profile
  // is only acted on AFTER a successful password check below, so the response
  // does not leak which emails exist.
  //
  // The profile's avatar_url is deliberately NOT used for the completeness
  // check: an uploaded picture is optional at signup (see
  // lib/auth/signup-status.ts). It rides the same embed only so the mobile
  // client can paint the signed-in member without a second /me round trip.
  const { data: rawUser } = await timer.measure("account_lookup", async () => db
    .from("users")
    .select(
      "id, name, email, password_hash, is_blocked, created_at, verification_status, verification_reapply_at, verification_rejection_reason, designer_profiles!user_id(id, avatar_url)",
    )
    .eq("email", normalizedEmail)
    .maybeSingle());
  const row = rawUser as unknown as LoginUserRow | null;
  const profile = row?.designer_profiles ?? null;

  if (!row) {
    // Generic error — do NOT reveal whether the email exists.
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  const passwordMatch = await timer.measure("password_compare", () => bcrypt.compare(password, row.password_hash));
  if (!passwordMatch) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  if (row.is_blocked) {
    return NextResponse.json(
      { error: "Your account has been suspended. Please contact support." },
      { status: 403 }
    );
  }

  if (isSignupIncomplete(profile)) {
    return NextResponse.json(
      {
        error:
          "Your account setup is incomplete. Please contact support so we can finish setting it up.",
        incompleteSignup: true,
      },
      { status: 403 }
    );
  }

  // Start noncritical settings alongside the remaining login work.
  const graceDaysPromise = row.verification_status === "approved"
    ? Promise.resolve(0)
    : timer.measure("verification_settings", getNewAccountGraceDays);

  // Rehash-on-login: hashes created at the old cost 12 make every login pay
  // ~350ms of pure-JS bcrypt CPU. On a successful login, downgrade the stored
  // hash to the current cost so the NEXT login is ~4x cheaper. New signups and
  // resets already hash at the current cost.
  let verifiedHash = row.password_hash;
  if (needsPasswordRehash(row.password_hash)) {
    try {
      const upgradedHash = await timer.measure("password_rehash", () => hashPassword(password));
      // Optimistic: only rehash the exact hash this login verified. A reset
      // that landed in between must not be overwritten with the old password.
      const { data: rehashed, error: rehashError } = await timer.measure("rehash_write", async () => db
        .from("users")
        .update({ password_hash: upgradedHash })
        .eq("id", row.id)
        .eq("password_hash", row.password_hash)
        .select("id"));
      if (!rehashError && rehashed && rehashed.length === 1) {
        verifiedHash = upgradedHash;
      }
    } catch (err) {
      // Non-fatal: the login itself succeeded; the hash is just upgraded next time.
      console.error("[login] password rehash failed:", err);
    }
  }

  let issued: { sessionId: string; sessionVersion: number };
  try {
    issued = await timer.measure("session_create_password_guard", () => createLoginSession({
      userId: row.id,
      expectedPasswordHash: verifiedHash,
      userAgent: request.headers.get("user-agent"),
    }));
  } catch (err) {
    if (err instanceof PasswordChangedError) {
      return NextResponse.json(
        { error: "Your password changed. Please sign in again." },
        { status: 401 },
      );
    }
    if (err instanceof AccountUnavailableError) {
      return NextResponse.json(
        { error: "Your account is unavailable. Please contact support." },
        { status: 403 },
      );
    }
    console.error("[login] session creation failed:", err);
    return NextResponse.json({ error: "Sign-in failed. Please try again." }, { status: 500 });
  }

  // The RPC checks the verified hash and issues the session atomically. A
  // later password reset revokes this row through the existing registry.
  const token = await timer.measure("sign", () => createSession({
    userId: row.id,
    email: row.email,
    role: "user",
    sid: issued.sessionId,
    sv: issued.sessionVersion,
  }));

  const graceDays = await graceDaysPromise;
  const verificationBannerVisible = isVerificationBannerVisible({
    status: row.verification_status,
    createdAt: row.created_at,
    graceDays,
  });

  const response = NextResponse.json({
    success: true,
    name: row.name,
    // The same shape GET /api/auth/me returns. The mobile client used to make
    // that extra round trip immediately after login; the login response
    // already holds the trusted row it needs.
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: "user",
      profileComplete: !!profile,
      avatar_url: profile?.avatar_url ?? null,
      verificationStatus: row.verification_status,
      verificationBannerVisible,
      verificationReapplyAt: row.verification_reapply_at,
      verificationRejectionReason: row.verification_rejection_reason,
    },
  });
  setSessionCookie(response, token, request.nextUrl.hostname);
  return response;
}
