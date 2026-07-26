import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createServiceClient } from "@/lib/supabase/service";
import { directSignupStep1Schema } from "@/lib/validations";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { moderateText } from "@/lib/moderation/text";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { contentHash } from "@/lib/moderation/normalize";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rl = await rateLimit(`signup:${ip}`, 5, 3600);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = directSignupStep1Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { name, email, password } = parsed.data;

  const db = createServiceClient();

  // Moderate the display name
  const nameDecision = await moderateText({ content: name, contentType: "username" });
  await logModerationDecision(db, {
    contentType: "username",
    contentHash: contentHash(name),
    decision: nameDecision,
  });
  if (!nameDecision.allowed) return moderationFailureResponse(nameDecision);

  // Guard against duplicate email
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

  // Create the user without an application_id (direct signup)
  const { data: user, error: userError } = await db
    .from("users")
    .insert({
      application_id: null,
      name,
      email: email.toLowerCase(),
      password_hash: passwordHash,
    })
    .select("id, name, email")
    .single();

  if (userError) {
    console.error("[signup/direct] user insert error:", userError);
    return NextResponse.json(
      { error: "Failed to create account. Please try again." },
      { status: 500 }
    );
  }

  // Issue a session so steps 2–4 can use requireSession
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
