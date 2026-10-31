import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createServiceClient } from "@/lib/supabase/service";
import { clearSessionCookie, getSessionForErasure } from "@/lib/auth/session";
import { revokeRealtimeSessions } from "@/lib/realtime/revoke";
import { logEvent } from "@/lib/observability/log";
import { rateLimit } from "@/lib/auth/rate-limit";
import { deleteAccountCascade } from "@/lib/account/delete";
import { parseDeleteAccountRequest } from "@/lib/account/delete-request";
import { sendAccountDeletedEmail } from "@/lib/email";

/**
 * Member-initiated account deletion.
 *
 * Requires the current password and the literal confirmation "DELETE" so a
 * stolen session alone cannot erase an account. This route is for a live
 * session; a blocked/suspended member whose sessions were revoked uses
 * /delete-account and /api/account/delete/credential instead.
 */
export async function POST(request: NextRequest) {
  // This path still requires a registry-valid session. It intentionally does
  // not bypass session revocation; the public credential path covers accounts
  // that cannot hold one.
  const session = await getSessionForErasure();
  const userId = session?.userId;
  if (!session || session.role !== "user" || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await rateLimit(`account-delete:${userId}`, 5, 3600);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many deletion attempts. Try again later." },
      { status: 429 },
    );
  }

  const parsed = parseDeleteAccountRequest(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const db = createServiceClient();
  const { data: row, error } = await db
    .from("users")
    .select("id, password_hash, email, name")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[account/delete] lookup error:", error);
    return NextResponse.json({ error: "Could not verify your account." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const passwordMatch = await bcrypt.compare(parsed.password, row.password_hash);
  if (!passwordMatch) {
    return NextResponse.json({ error: "Password is incorrect." }, { status: 403 });
  }

  try {
    const summary = await deleteAccountCascade(db, userId, {
      expectedPasswordHash: row.password_hash,
    });

    // Confirmation is sent after the rows are gone, to the address captured
    // before deletion. A mail failure must not resurrect the account or turn a
    // completed deletion into an error the member could retry.
    try {
      await sendAccountDeletedEmail(row.email, row.name);
    } catch (emailError) {
      console.error("[account/delete] confirmation email error:", emailError);
    }

    // The users delete cascaded auth_sessions away, so every token is already
    // invalid. Tell the realtime Worker to close any sockets that are still
    // open for this member.
    try {
      await revokeRealtimeSessions({ userId, all: true });
    } catch (error) {
      logEvent("warn", {
        event: "auth.account_deleted.realtime_failed",
        userId,
        error,
      });
    }

    const response = NextResponse.json({
      success: true,
      communities: {
        transferred: summary.transferred,
        deleted: summary.deleted,
        r2_cleanup: summary.r2Cleanup,
      },
    });
    clearSessionCookie(response, request.nextUrl.hostname);
    return response;
  } catch (deleteError) {
    console.error("[account/delete] deletion error:", deleteError);
    if (
      deleteError instanceof Error &&
      deleteError.message.includes("password_changed")
    ) {
      return NextResponse.json(
        { error: "Your password changed elsewhere. Please sign in again." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error:
          "Your account could not be deleted. Please try again, or email hello@uxcommunity.in.",
      },
      { status: 500 },
    );
  }
}
