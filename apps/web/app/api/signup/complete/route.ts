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

  // Validate invitation token (must exist and not be expired)
  const { data: invitation } = await db
    .from("invitations")
    .select("id, expires_at, used_at, application_id")
    .eq("token", token)
    .maybeSingle();

  if (!invitation) {
    return NextResponse.json(
      { error: "Invalid or expired invitation token." },
      { status: 400 }
    );
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "This invitation link has expired. Please contact us." },
      { status: 400 }
    );
  }

  // Always check by application_id first — this is the single-account-per-invite
  // guard and also handles resuming an incomplete signup (regardless of used_at).
  const { data: existingUser } = await db
    .from("users")
    .select("id, name, email, password_hash")
    .eq("application_id", invitation.application_id)
    .maybeSingle();

  if (existingUser) {
    // A user already exists for this application — the invite was started before.
    // Verify their password so they can restore the session and continue from step 2/3.
    const passwordMatch = await bcrypt.compare(password, existingUser.password_hash);
    if (!passwordMatch) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const sessionToken = await createSession({
      userId: existingUser.id,
      email: existingUser.email,
      role: "user",
    });

    const response = NextResponse.json({
      success: true,
      userId: existingUser.id,
      name: existingUser.name,
      resumed: true,
    });
    setSessionCookie(response, sessionToken);
    return response;
  }

  // If used_at is set and no user exists, the link was genuinely fully used.
  if (invitation.used_at) {
    return NextResponse.json(
      { error: "This invitation link has already been used." },
      { status: 400 }
    );
  }

  // Fresh signup — additionally guard against the same email from a different invite.
  const { data: existingByEmail } = await db
    .from("users")
    .select("id")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (existingByEmail) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Create the user — DO NOT mark used_at yet.
  // used_at is set only after all 3 steps complete (avatar route).
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
    // Unique-violation on application_id (code 23505) means a concurrent
    // request just created the user. Fetch that row and resume the session.
    if ((userError as { code?: string }).code === "23505") {
      const { data: raceUser } = await db
        .from("users")
        .select("id, name, email, password_hash")
        .eq("application_id", invitation.application_id)
        .maybeSingle();

      if (raceUser) {
        const match = await bcrypt.compare(password, raceUser.password_hash);
        if (!match) {
          return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
        }
        const sessionToken = await createSession({
          userId: raceUser.id,
          email: raceUser.email,
          role: "user",
        });
        const resp = NextResponse.json({
          success: true,
          userId: raceUser.id,
          name: raceUser.name,
          resumed: true,
        });
        setSessionCookie(resp, sessionToken);
        return resp;
      }
    }

    console.error("[signup/complete] user insert error:", userError);
    return NextResponse.json(
      { error: "Failed to create account. Please try again." },
      { status: 500 }
    );
  }

  // Issue a session so steps 2 and 3 can use requireSession.
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
