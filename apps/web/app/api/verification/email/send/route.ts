import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import { sendVerificationCodeEmail } from "@/lib/email";
import {
  generateVerificationCode,
  hashVerificationCode,
} from "@/lib/verification/code";
import {
  VERIFICATION_CODE_TTL_MINUTES,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from "@/lib/verification/rules";

/**
 * POST /api/verification/email/send
 *
 * Sends a six-digit code to the account email. The address is read-only by
 * design: verification proves control of the email the account already uses.
 */
export async function POST() {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }

  const userId = session.userId!;
  const rl = await rateLimit(`verification:email:${userId}`, 5, 3600, { failClosed: true });
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many codes requested. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      },
    );
  }

  const db = createServiceClient();
  const { data: user } = await db
    .from("users")
    .select("name, email, email_verified_at")
    .eq("id", userId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  const row = user as { name: string | null; email: string; email_verified_at: string | null };
  if (row.email_verified_at) {
    return NextResponse.json({ success: true, alreadyVerified: true });
  }

  const { data: existing } = await db
    .from("verification_email_codes")
    .select("last_sent_at")
    .eq("user_id", userId)
    .maybeSingle();
  const lastSent = (existing as { last_sent_at: string } | null)?.last_sent_at;
  if (lastSent) {
    const elapsed = Date.now() - new Date(lastSent).getTime();
    const cooldownMs = VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;
    if (elapsed < cooldownMs) {
      return NextResponse.json(
        { error: "Please wait before requesting another code.", retryAfter: Math.ceil((cooldownMs - elapsed) / 1000) },
        { status: 429 },
      );
    }
  }

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);

  const { error: saveError } = await (db.from("verification_email_codes") as any).upsert(
    {
      user_id: userId,
      code_hash: hashVerificationCode(code),
      expires_at: expiresAt.toISOString(),
      attempts: 0,
      last_sent_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (saveError) {
    console.error("[verification/email/send] save error:", saveError);
    return NextResponse.json({ error: "Could not create the code." }, { status: 500 });
  }

  try {
    await sendVerificationCodeEmail(
      row.email,
      row.name?.trim() || "there",
      code,
      VERIFICATION_CODE_TTL_MINUTES,
    );
  } catch (error) {
    console.error("[verification/email/send] email error:", error);
    return NextResponse.json(
      { error: "Could not send the code. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    email: row.email,
    expiresAt: expiresAt.toISOString(),
  });
}
