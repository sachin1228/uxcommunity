import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createServiceClient } from "@/lib/supabase/service";
import {
  clearSessionCookie,
  invalidateUserLiveness,
  requireSession,
} from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { deleteAccountCascade } from "@/lib/account/delete";
import { parseDeleteAccountRequest } from "@/lib/account/delete-request";
import { sendAccountDeletedEmail } from "@/lib/email";

/**
 * Member-initiated account deletion.
 *
 * Requires the current password and the literal confirmation "DELETE" so a
 * stolen session alone cannot erase an account. A verification-restricted
 * account may still delete itself (allowUnverified) — leaving must never be
 * gated on a review.
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (e) {
    return e as Response;
  }

  const userId = session.userId;
  if (!userId) {
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
    const summary = await deleteAccountCascade(db, userId);
    invalidateUserLiveness(userId);

    // Confirmation is sent after the rows are gone, to the address captured
    // before deletion. A mail failure must not resurrect the account or turn a
    // completed deletion into an error the member could retry.
    try {
      await sendAccountDeletedEmail(row.email, row.name);
    } catch (emailError) {
      console.error("[account/delete] confirmation email error:", emailError);
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
    return NextResponse.json(
      {
        error:
          "Your account could not be deleted. Please try again, or email hello@uxcommunity.in.",
      },
      { status: 500 },
    );
  }
}
