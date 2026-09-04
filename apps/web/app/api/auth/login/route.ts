import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createServiceClient } from "@/lib/supabase/service";
import { loginSchema } from "@/lib/validations";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { hashPassword, needsPasswordRehash } from "@/lib/auth/password";

type LoginUserRow = {
  id: string;
  name: string | null;
  email: string;
  password_hash: string;
  is_blocked: boolean;
  designer_profiles: Array<{ id: string; avatar_url: string | null }> | null;
};

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";

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
  const [rlIp, rlEmail] = await Promise.all([
    rateLimit(`login:ip:${ip}`, 10, 900),
    rateLimit(`login:email:${normalizedEmail}`, 20, 900),
  ]);
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
    email.toLowerCase() === adminEmail.toLowerCase() &&
    password === adminPassword
  ) {
    const token = await createSession({ email: adminEmail, role: "admin" });
    const response = NextResponse.json({ success: true, redirect: "/admin" });
    setSessionCookie(response, token, request.nextUrl.hostname);
    return response;
  }

  const db = createServiceClient();

  // Single round trip: the users row plus its (1:1) designer profile, embedded
  // through the foreign key. Previously this was two sequential Supabase REST
  // queries — one for users by email, then one for designer_profiles by the
  // resulting user_id. A missing profile is only acted on AFTER a successful
  // password check below, so the response does not leak which emails exist.
  const { data: rawUser } = await db
    .from("users")
    .select(
      "id, name, email, password_hash, is_blocked, designer_profiles(id, avatar_url)"
    )
    .eq("email", normalizedEmail)
    .maybeSingle();
  const row = rawUser as unknown as LoginUserRow | null;
  const profile = row?.designer_profiles?.[0] ?? null;

  if (!row) {
    // Generic error — do NOT reveal whether the email exists.
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  const passwordMatch = await bcrypt.compare(password, row.password_hash);
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

  if (!profile || !profile.avatar_url) {
    return NextResponse.json(
      {
        error:
          "Your account setup is incomplete. Please finish signing up using the invitation link sent to your email.",
        incompleteSignup: true,
      },
      { status: 403 }
    );
  }

  // Rehash-on-login: hashes created at the old cost 12 make every login pay
  // ~350ms of pure-JS bcrypt CPU. On a successful login, downgrade the stored
  // hash to the current cost so the NEXT login is ~4x cheaper. New signups and
  // resets already hash at the current cost.
  if (needsPasswordRehash(row.password_hash)) {
    try {
      const upgradedHash = await hashPassword(password);
      await db.from("users").update({ password_hash: upgradedHash }).eq("id", row.id);
    } catch (err) {
      // Non-fatal: the login itself succeeded; the hash is just upgraded next time.
      console.error("[login] password rehash failed:", err);
    }
  }

  const token = await createSession({
    userId: row.id,
    email: row.email,
    role: "user",
  });

  const response = NextResponse.json({ success: true, name: row.name });
  setSessionCookie(response, token, request.nextUrl.hostname);
  return response;
}
