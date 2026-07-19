import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import { z } from "zod";

const schema = z
  .object({
    token: z.string().min(1, "Token is required"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Must contain at least one uppercase letter")
      .regex(/[0-9]/, "Must contain at least one number"),
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`reset-confirm:${ip}`, 10, 3600);
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { token, password } = parsed.data;
  const db = createServiceClient();

  const { data: reset } = await db
    .from("password_resets")
    .select("id, user_id, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (!reset) {
    return NextResponse.json(
      { error: "Invalid or expired reset link." },
      { status: 400 }
    );
  }

  if (reset.used_at) {
    return NextResponse.json(
      { error: "This reset link has already been used. Please request a new one." },
      { status: 410 }
    );
  }

  if (new Date(reset.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "This reset link has expired. Please request a new one." },
      { status: 410 }
    );
  }

  // ── Atomic token claim (C-3: fix TOCTOU race) ───────────────────────
  // Mark the token as used BEFORE updating the password. The IS NULL guard
  // ensures only one concurrent request can win; if another request already
  // claimed it, we return 410 without touching the password.
  const { data: claimed } = await db
    .from("password_resets")
    .update({ used_at: new Date().toISOString() })
    .eq("id", reset.id)
    .is("used_at", null)
    .select("id");

  if (!claimed || claimed.length === 0) {
    return NextResponse.json(
      { error: "This reset link has already been used. Please request a new one." },
      { status: 410 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { error: updateError } = await db
    .from("users")
    .update({ password_hash: passwordHash })
    .eq("id", reset.user_id);

  if (updateError) {
    // Roll back the used_at claim so the user can retry
    await db
      .from("password_resets")
      .update({ used_at: null })
      .eq("id", reset.id);

    console.error("[reset-confirm] update error:", updateError);
    return NextResponse.json(
      { error: "Failed to update password. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
