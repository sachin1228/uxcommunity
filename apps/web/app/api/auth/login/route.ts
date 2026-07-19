import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createServiceClient } from "@/lib/supabase/service";
import { loginSchema } from "@/lib/validations";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";

  // IP-level gate
  const rlIp = rateLimit(`login:ip:${ip}`, 10, 900); // 10 per 15 min per IP
  if (!rlIp.success) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rlIp.resetAt - Date.now()) / 1000)) },
      }
    );
  }

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

  // Per-account gate: prevents distributed brute-force (many IPs, one target)
  const rlEmail = rateLimit(`login:email:${email.toLowerCase()}`, 20, 900); // 20 per 15 min per account
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
    setSessionCookie(response, token);
    return response;
  }

  const db = createServiceClient();

  const { data: user } = await db
    .from("users")
    .select("id, name, email, password_hash, application_id, is_blocked")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (!user) {
    // Generic error — do NOT query the applications table here, that
    // would reveal whether the email was used to apply (user enumeration).
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  if (user.is_blocked) {
    return NextResponse.json(
      { error: "Your account has been suspended. Please contact support." },
      { status: 403 }
    );
  }

  const { data: profile } = await db
    .from("designer_profiles")
    .select("id, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

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

  const token = await createSession({
    userId: user.id,
    email: user.email,
    role: "user",
  });

  const response = NextResponse.json({ success: true, name: user.name });
  setSessionCookie(response, token);
  return response;
}
