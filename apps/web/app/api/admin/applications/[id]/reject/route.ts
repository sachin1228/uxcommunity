import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { sendRejectionEmail } from "@/lib/email";

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

  await db
    .from("applications")
    .update({ status: "rejected" })
    .eq("id", id);

  // Send rejection email
  try {
    await sendRejectionEmail(application.email, application.name);
  } catch (emailErr) {
    console.error("[reject] email error:", emailErr);
    return NextResponse.json({
      success: true,
      warning: "Rejected, but the rejection email failed to send. Check RESEND_API_KEY.",
    });
  }

  return NextResponse.json({ success: true });
}
