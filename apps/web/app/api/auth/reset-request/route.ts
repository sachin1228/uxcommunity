import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendPasswordResetEmail } from "@/lib/email";
import { rateLimit } from "@/lib/auth/rate-limit";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rl = await rateLimit(`reset-request:${ip}`, 5, 3600); // 5 per hour per IP
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 422 }
    );
  }

  const { email } = parsed.data;
  const db = createServiceClient();

  // Always return the same response to prevent user enumeration
  const genericOk = NextResponse.json({
    success: true,
    message:
      "If an account with that email exists, you'll receive a reset link shortly.",
  });

  const { data: user } = await db
    .from("users")
    .select("id, name, email")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (!user) return genericOk; // don't reveal whether the email exists

  // Invalidate any existing unused tokens for this user
  await db
    .from("password_resets")
    .update({ used_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("used_at", null);

  // Create new token
  const { data: reset, error } = await db
    .from("password_resets")
    .insert({ user_id: user.id })
    .select("token")
    .single();

  if (error || !reset) {
    console.error("[reset-request] insert error:", error);
    return genericOk; // still return generic to avoid leaking info
  }

  try {
    await sendPasswordResetEmail(user.email, user.name, reset.token);
  } catch (emailErr) {
    console.error("[reset-request] email error:", emailErr);
  }

  return genericOk;
}
