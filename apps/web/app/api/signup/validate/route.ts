import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ valid: false, error: "Token is required" }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: invitation } = await db
    .from("invitations")
    .select("id, expires_at, used_at, application_id, applications(name, email)")
    .eq("token", token)
    .maybeSingle();

  if (!invitation) {
    return NextResponse.json({ valid: false, error: "Invalid invitation link." }, { status: 404 });
  }

  if (invitation.used_at) {
    return NextResponse.json(
      { valid: false, error: "This invitation link has already been used." },
      { status: 410 }
    );
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return NextResponse.json(
      { valid: false, error: "This invitation link has expired. Please contact us." },
      { status: 410 }
    );
  }

  const appsRaw = invitation.applications as unknown;
  const app = (Array.isArray(appsRaw) ? appsRaw[0] : appsRaw) as
    | { name: string; email: string }
    | null;

  return NextResponse.json({
    valid: true,
    applicationId: invitation.application_id,
    applicantName: app?.name ?? "",
    applicantEmail: app?.email ?? "",
  });
}
