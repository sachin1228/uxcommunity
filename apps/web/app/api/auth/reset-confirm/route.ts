import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getRequestClientIp } from "@/lib/global-request-rate-limit";
import { hashPassword } from "@/lib/auth/password";
import { completePasswordReset } from "@/lib/auth/session-registry";
import { revokeRealtimeSessions } from "@/lib/realtime/revoke";
import { logEvent } from "@/lib/observability/log";
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
  const ip = getRequestClientIp(request);
  const rl = await rateLimit(`reset-confirm:${ip}`, 10, 3600);
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

  // One transaction claims the token, updates the hash, bumps
  // users.session_version and revokes every registry row. A concurrent reset
  // either loses the claim or produces a token generation that no issued JWT
  // can match.
  const passwordHash = await hashPassword(password);

  let result;
  try {
    result = await completePasswordReset(token, passwordHash);
  } catch (error) {
    console.error("[reset-confirm] atomic reset failed:", error);
    return NextResponse.json(
      { error: "Failed to update password. Please try again." },
      { status: 500 }
    );
  }

  if (result.status === "used") {
    return NextResponse.json(
      { error: "This reset link has already been used. Please request a new one." },
      { status: 410 }
    );
  }
  if (result.status === "expired") {
    return NextResponse.json(
      { error: "This reset link has expired. Please request a new one." },
      { status: 410 }
    );
  }
  if (result.status !== "ok" || !result.userId) {
    return NextResponse.json(
      { error: "Invalid or expired reset link." },
      { status: 400 }
    );
  }

  try {
    await revokeRealtimeSessions({ userId: result.userId, all: true });
  } catch (error) {
    logEvent("warn", {
      event: "auth.password_reset.realtime_failed",
      userId: result.userId,
      error,
    });
  }

  return NextResponse.json({ success: true });
}
