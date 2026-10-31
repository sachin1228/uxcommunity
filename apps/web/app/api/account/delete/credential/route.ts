import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createServiceClient } from "@/lib/supabase/service";
import { clearSessionCookie } from "@/lib/auth/session";
import { revokeRealtimeSessions } from "@/lib/realtime/revoke";
import { logEvent } from "@/lib/observability/log";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getRequestClientIp } from "@/lib/global-request-rate-limit";
import { deleteAccountCascade } from "@/lib/account/delete";
import { deleteCredentialSchema } from "@/lib/account/delete-credential";
import { sendAccountDeletedEmail } from "@/lib/email";

/**
 * Deletion-only path for accounts that cannot hold a live session.
 *
 * A ban/suspension revokes every session and bumps session_version, so the
 * session-backed route cannot authenticate exactly the people who most need
 * erasure. This route accepts the account email + password + literal DELETE,
 * never creates a session, and only performs the same cascade used by the
 * signed-in route. It cannot reach any other protected endpoint.
 */
export async function POST(request: NextRequest) {
  const ip = getRequestClientIp(request);
  const body = await request.json().catch(() => null);
  const parsed = deleteCredentialSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid deletion request." },
      { status: 422 },
    );
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit(`account-delete-credential:ip:${ip}`, 10, 3600, { failClosed: true }),
    rateLimit(`account-delete-credential:email:${normalizedEmail}`, 5, 3600, { failClosed: true }),
  ]);
  if (!ipLimit.success || !emailLimit.success) {
    return NextResponse.json(
      { error: "Too many deletion attempts. Try again later." },
      { status: 429 },
    );
  }

  const db = createServiceClient();
  const { data: row, error } = await db
    .from("users")
    .select("id, password_hash, email, name")
    .eq("email", normalizedEmail)
    .maybeSingle();

  // Same response for unknown email and wrong password, so this endpoint does
  // not become an account-existence oracle.
  const invalid = NextResponse.json(
    { error: "The email or password is incorrect." },
    { status: 401 },
  );
  if (error) {
    console.error("[account/delete/credential] lookup error:", error);
    return NextResponse.json(
      { error: "Could not verify your account." },
      { status: 500 },
    );
  }
  if (!row) return invalid;

  const passwordMatch = await bcrypt.compare(password, row.password_hash);
  if (!passwordMatch) return invalid;

  try {
    await deleteAccountCascade(db, row.id, {
      expectedPasswordHash: row.password_hash,
    });
  } catch (deleteError) {
    console.error("[account/delete/credential] deletion error:", deleteError);
    return NextResponse.json(
      {
        error:
          "Your account could not be deleted. Please try again, or email hello@uxcommunity.in.",
      },
      { status: 500 },
    );
  }

  try {
    await sendAccountDeletedEmail(row.email, row.name);
  } catch (emailError) {
    console.error("[account/delete/credential] confirmation email error:", emailError);
  }

  try {
    await revokeRealtimeSessions({ userId: row.id, all: true });
  } catch (error) {
    logEvent("warn", {
      event: "auth.account_deleted.realtime_failed",
      userId: row.id,
      error,
    });
  }

  const response = NextResponse.json({ success: true });
  // A stale cookie on this device must not look like a live session after the
  // account row is gone.
  clearSessionCookie(response, request.nextUrl.hostname);
  return response;
}
