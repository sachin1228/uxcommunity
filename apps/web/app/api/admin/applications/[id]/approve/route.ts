import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { sendInvitationEmail } from "@/lib/email";

const EXPIRY_DAYS = parseInt(process.env.INVITATION_EXPIRY_DAYS ?? "7", 10);

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const { id } = await params;
  const db = createServiceClient();

  const { data: application, error: fetchError } = await db
    .from("applications")
    .select("id, name, email, status")
    .eq("id", id)
    .single();

  if (fetchError || !application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  if (application.status !== "pending") {
    return NextResponse.json(
      { error: `Application is already ${application.status}.` },
      { status: 409 }
    );
  }

  // Update status
  await db
    .from("applications")
    .update({ status: "approved" })
    .eq("id", id);

  // Generate invitation token (DB default generates the token via gen_random_bytes)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + EXPIRY_DAYS);

  const { data: invitation, error: invError } = await db
    .from("invitations")
    .insert({
      application_id: id,
      expires_at: expiresAt.toISOString(),
    })
    .select("token")
    .single();

  if (invError || !invitation) {
    console.error("[approve] invitation insert error:", invError);
    return NextResponse.json(
      { error: "Failed to generate invitation token." },
      { status: 500 }
    );
  }

  // Send invitation email
  try {
    await sendInvitationEmail(application.email, application.name, invitation.token);
  } catch (emailErr) {
    console.error("[approve] email error:", emailErr);
    // Don't fail the whole request — the invitation is saved and can be resent
    return NextResponse.json({
      success: true,
      warning: "Approved, but the invitation email failed to send. Check RESEND_API_KEY.",
      token: invitation.token,
    });
  }

  return NextResponse.json({ success: true });
}
