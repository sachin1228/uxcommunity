import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { sendInvitationEmail, sendResumeSignupEmail } from "@/lib/email";

/** How long a resume link stays valid. Matches the invitation window by default. */
const RESUME_TTL_DAYS = (() => {
  const parsed = Number(process.env.INVITATION_EXPIRY_DAYS ?? 7);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
})();

interface AttemptRow {
  id: string;
  email: string;
  name: string | null;
  flow: "direct" | "invitation";
  application_id: string | null;
  status: "started" | "completed";
}

const db = () => createServiceClient();

/**
 * POST /api/admin/signup-attempts/[id]/resume
 *
 * Emails the drop-off a one-click link back into signup:
 *  - invitation attempts re-send their original invitation, so completing
 *    signup still links the account to the application;
 *  - direct attempts get a fresh resume token, valid for RESUME_TTL_DAYS.
 *
 * The token is written BEFORE the email is sent so a failed send never leaves
 * a link that cannot be validated; retrying rotates it.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;

  const { data: attempt, error } = (await db()
    .from("signup_attempts")
    .select("id, email, name, flow, application_id, status")
    .eq("id", id)
    .maybeSingle()) as unknown as { data: AttemptRow | null; error: unknown };

  if (error) {
    console.error("[admin/signup-attempts/resume] load error:", error);
    return NextResponse.json({ error: "Failed to load this signup." }, { status: 500 });
  }
  if (!attempt) {
    return NextResponse.json({ error: "Signup not found." }, { status: 404 });
  }
  if (attempt.status !== "started") {
    return NextResponse.json(
      { error: "This person has already finished signing up." },
      { status: 409 }
    );
  }

  const now = new Date();
  const displayName = attempt.name?.trim() || "there";

  // ── Invitation drop-offs: re-send the original invitation ──────────────
  if (attempt.flow === "invitation" && attempt.application_id) {
    const { data: invitation } = (await db()
      .from("invitations")
      .select("token, expires_at, used_at")
      .eq("application_id", attempt.application_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as unknown as {
        data: { token: string; expires_at: string; used_at: string | null } | null;
      };

    if (!invitation || invitation.used_at || new Date(invitation.expires_at) < now) {
      return NextResponse.json(
        { error: "Their invitation has expired. Send a fresh invitation from Applications." },
        { status: 409 }
      );
    }

    try {
      await sendInvitationEmail(attempt.email, displayName, invitation.token);
    } catch (sendError) {
      console.error("[admin/signup-attempts/resume] invitation send error:", sendError);
      return NextResponse.json(
        { error: "Failed to send the email. Please check the mail configuration and retry." },
        { status: 502 }
      );
    }

    await (db().from("signup_attempts") as any)
      .update({ resume_email_sent_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("id", id);

    return NextResponse.json({ ok: true, method: "invitation" });
  }

  // ── Direct drop-offs: issue a resume token ─────────────────────────────
  const resumeToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + RESUME_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { error: saveError } = await (db().from("signup_attempts") as any)
    .update({
      resume_token: resumeToken,
      resume_token_expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", id);

  if (saveError) {
    console.error("[admin/signup-attempts/resume] token save error:", saveError);
    return NextResponse.json({ error: "Failed to create the resume link." }, { status: 500 });
  }

  try {
    await sendResumeSignupEmail(attempt.email, displayName, resumeToken);
  } catch (sendError) {
    console.error("[admin/signup-attempts/resume] resume send error:", sendError);
    return NextResponse.json(
      { error: "Failed to send the email. Please check the mail configuration and retry." },
      { status: 502 }
    );
  }

  await (db().from("signup_attempts") as any)
    .update({ resume_email_sent_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, method: "resume" });
}
