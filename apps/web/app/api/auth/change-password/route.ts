import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import {
  AccountUnavailableError,
  PasswordChangedError,
  changeUserPassword,
} from "@/lib/auth/session-registry";
import { revokeRealtimeSessions } from "@/lib/realtime/revoke";
import { rateLimit } from "@/lib/auth/rate-limit";
import { logEvent } from "@/lib/observability/log";

const schema = z
  .object({
    current_password: z.string().min(1, "Enter your current password"),
    new_password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Must contain at least one uppercase letter")
      .regex(/[0-9]/, "Must contain at least one number"),
    confirm_password: z.string(),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

/**
 * Password change (not reset).
 *
 * The current device stays signed in on purpose: its registry row is excluded
 * from the revocation, and `change_user_password` does not bump the global
 * version. Every OTHER device is revoked, so a stolen session on a second
 * device cannot survive a password change.
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }

  const userId = session.userId!;
  const limit = await rateLimit(`change-password:${userId}`, 5, 3600);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 },
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
      { status: 422 },
    );
  }

  const { current_password, new_password } = parsed.data;

  if (current_password === new_password) {
    return NextResponse.json(
      { error: "Choose a password different from your current one." },
      { status: 422 },
    );
  }

  const db = createServiceClient();
  const { data: row, error } = await db
    .from("users")
    .select("id, password_hash")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[auth/change-password] lookup failed:", error);
    return NextResponse.json({ error: "Could not verify your account." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const matches = await bcrypt.compare(current_password, row.password_hash);
  if (!matches) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });
  }

  try {
    const hash = await hashPassword(new_password);
    await changeUserPassword(userId, hash, session.sid, row.password_hash);
  } catch (error) {
    if (error instanceof AccountUnavailableError) {
      return NextResponse.json({ error: "Account is unavailable." }, { status: 401 });
    }
    if (error instanceof PasswordChangedError) {
      return NextResponse.json(
        { error: "Your password changed elsewhere. Please sign in again." },
        { status: 409 },
      );
    }
    console.error("[auth/change-password] update failed:", error);
    return NextResponse.json(
      { error: "Password could not be changed. Please try again." },
      { status: 500 },
    );
  }

  try {
    await revokeRealtimeSessions({ userId, exceptSid: session.sid });
  } catch (error) {
    logEvent("warn", {
      event: "auth.password_change.realtime_failed",
      userId,
      error,
    });
  }

  return NextResponse.json({
    success: true,
    message: "Password changed. Other devices have been signed out.",
  });
}
