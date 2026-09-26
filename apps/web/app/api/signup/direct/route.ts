import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { directSignupStep1Schema } from "@/lib/validations";
import { rateLimit } from "@/lib/auth/rate-limit";
import { recordSignupAttempt } from "@/lib/signup-attempts";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  // Validation-only endpoint (checks the email, creates nothing), so the cap is
  // generous: it stops bot loops without ever punishing a human correcting typos.
  const rl = await rateLimit(`signup:step1:direct:v2:${ip}`, 60, 3600);
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

  const db = createServiceClient();
  const { name, email } = parsed.data;

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

  // Record the funnel entry so a member who abandons before the final step is
  // visible in Admin → Incomplete Signups. Best-effort, never blocks signup.
  await recordSignupAttempt({ email, name, flow: "direct" });

  // Step one is validation-only. No account or session exists until step four.
  return NextResponse.json({ success: true });
}
