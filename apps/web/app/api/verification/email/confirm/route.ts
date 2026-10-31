import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import { verificationCodeMatches } from "@/lib/verification/code";
import { VERIFICATION_CODE_MAX_ATTEMPTS } from "@/lib/verification/rules";

/** POST /api/verification/email/confirm { code } */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }

  const userId = session.userId!;
  const rl = await rateLimit(`verification:email:confirm:${userId}`, 15, 900);
  if (!rl.success) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let code = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    if (typeof body.code === "string") code = body.code.trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the six-digit code." }, { status: 422 });
  }

  const db = createServiceClient();
  const { data: stored } = await db
    .from("verification_email_codes")
    .select("code_hash, expires_at, attempts")
    .eq("user_id", userId)
    .maybeSingle();

  const row = stored as
    | { code_hash: string; expires_at: string; attempts: number }
    | null;
  if (!row) {
    return NextResponse.json({ error: "Request a new code." }, { status: 410 });
  }
  if (new Date(row.expires_at) < new Date()) {
    await db.from("verification_email_codes").delete().eq("user_id", userId);
    return NextResponse.json({ error: "That code has expired. Request a new one." }, { status: 410 });
  }
  if (row.attempts >= VERIFICATION_CODE_MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many incorrect codes. Request a new one." },
      { status: 429 },
    );
  }

  if (!verificationCodeMatches(code, row.code_hash)) {
    const attempts = row.attempts + 1;
    await db
      .from("verification_email_codes")
      .update({ attempts })
      .eq("user_id", userId);
    return NextResponse.json(
      {
        error: "That code is incorrect.",
        attemptsLeft: Math.max(0, VERIFICATION_CODE_MAX_ATTEMPTS - attempts),
      },
      { status: 422 },
    );
  }

  const verifiedAt = new Date().toISOString();
  const { error: updateError } = await db
    .from("users")
    .update({ email_verified_at: verifiedAt })
    .eq("id", userId);

  if (updateError) {
    console.error("[verification/email/confirm] update error:", updateError);
    return NextResponse.json({ error: "Could not verify the email." }, { status: 500 });
  }

  await db.from("verification_email_codes").delete().eq("user_id", userId);
  return NextResponse.json({ success: true, emailVerifiedAt: verifiedAt });
}
