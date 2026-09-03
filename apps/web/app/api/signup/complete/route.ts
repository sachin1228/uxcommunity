import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { signupStep1Schema } from "@/lib/validations";
import { rateLimit } from "@/lib/auth/rate-limit";
import { moderateText } from "@/lib/moderation/text";
import { moderationFailureResponse } from "@/lib/moderation/http";
import { logModerationDecision } from "@/lib/moderation/log";
import { contentHash } from "@/lib/moderation/normalize";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rl = await rateLimit(`signup:step1:complete:${ip}`, 20, 3600);
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

  const parsed = signupStep1Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { name, email, token } = parsed.data;
  const db = createServiceClient();
  const nameDecision = await moderateText({ content: name, contentType: "username" });
  await logModerationDecision(db, {
    contentType: "username",
    contentHash: contentHash(name),
    decision: nameDecision,
  });
  if (!nameDecision.allowed) return moderationFailureResponse(nameDecision);

  const { data: invitation } = await db
    .from("invitations")
    .select("expires_at, used_at, application_id")
    .eq("token", token)
    .maybeSingle();

  if (!invitation || invitation.used_at || new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "This invitation link is invalid, expired, or already used." },
      { status: 409 }
    );
  }

  const [{ data: existingByApplication }, { data: existingByEmail }] = await Promise.all([
    db.from("users").select("id").eq("application_id", invitation.application_id).maybeSingle(),
    db.from("users").select("id").eq("email", email.toLowerCase()).maybeSingle(),
  ]);

  if (existingByApplication || existingByEmail) {
    return NextResponse.json(
      { error: "An account has already been created for this invitation or email." },
      { status: 409 }
    );
  }

  // Step one is validation-only. The invitation remains reusable until step four commits.
  return NextResponse.json({ success: true });
}
