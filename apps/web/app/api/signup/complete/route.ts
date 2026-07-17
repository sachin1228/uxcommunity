import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createServiceClient } from "@/lib/supabase/service";
import { signupStep1Schema } from "@/lib/validations";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`signup:${ip}`, 5, 3600);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = signupStep1Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { name, email, password } = parsed.data;
  const { token } = (body as { token?: string });

  if (!token) {
    return NextResponse.json({ error: "Invitation token is required." }, { status: 400 });
  }

  const db = createServiceClient();

  // Validate invitation token
  const { data: invitation } = await db
    .from("invitations")
    .select("id, expires_at, used_at, application_id")
    .eq("token", token)
    .maybeSingle();

  if (!invitation || invitation.used_at || new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "Invalid or expired invitation token." },
      { status: 400 }
    );
  }

  // Check if user already exists for this application
  const { data: existing } = await db
    .from("users")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Create user
  const { data: user, error: userError } = await db
    .from("users")
    .insert({
      application_id: invitation.application_id,
      name,
      email: email.toLowerCase(),
      password_hash: passwordHash,
    })
    .select("id, name, email")
    .single();

  if (userError) {
    console.error("[signup/complete] user insert error:", userError);
    return NextResponse.json(
      { error: "Failed to create account. Please try again." },
      { status: 500 }
    );
  }

  // Mark invitation as used
  await db
    .from("invitations")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invitation.id);

  // Start a session so Step 2 can use it
  const sessionToken = await createSession({
    userId: user.id,
    email: user.email,
    role: "user",
  });

  const response = NextResponse.json({
    success: true,
    userId: user.id,
    name: user.name,
  });
  setSessionCookie(response, sessionToken);
  return response;
}
