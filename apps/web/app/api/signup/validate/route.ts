import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

type ResumeStep = 2 | 3;

/** Check how far through signup the user for this application has progressed. */
async function getResumeStep(
  db: ReturnType<typeof import("@/lib/supabase/service").createServiceClient>,
  applicationId: string
): Promise<ResumeStep | "complete" | "none"> {
  const { data: user } = await db
    .from("users")
    .select("id")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (!user) return "none";

  const { data: profile } = await db
    .from("designer_profiles")
    .select("id, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) return 2; // User created, profile not saved yet
  if (!profile.avatar_url) return 3; // Profile saved, avatar not set yet
  return "complete"; // All 3 steps done
}

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

  if (invitation.used_at) {
    // used_at is set — could be truly complete, or could be a stale state.
    const resumeStep = await getResumeStep(db, invitation.application_id);

    if (resumeStep === "complete") {
      return NextResponse.json(
        { valid: false, error: "This invitation link has already been used." },
        { status: 410 }
      );
    }

    if (resumeStep === "none") {
      // used_at is set but no user exists — genuinely invalid
      return NextResponse.json(
        { valid: false, error: "This invitation link has already been used." },
        { status: 410 }
      );
    }

    // Signup is in progress — allow the user to resume
    return NextResponse.json({
      valid: true,
      resumeStep,
      applicationId: invitation.application_id,
      applicantName: app?.name ?? "",
      applicantEmail: app?.email ?? "",
    });
  }

  // used_at is null — check whether a signup is already in progress (mid-flow).
  // This lets us show the correct step after a page refresh before step 3 completes.
  const resumeStep = await getResumeStep(db, invitation.application_id);

  if (resumeStep !== "none" && resumeStep !== "complete") {
    return NextResponse.json({
      valid: true,
      resumeStep,
      applicationId: invitation.application_id,
      applicantName: app?.name ?? "",
      applicantEmail: app?.email ?? "",
    });
  }

  return NextResponse.json({
    valid: true,
    applicationId: invitation.application_id,
    applicantName: app?.name ?? "",
    applicantEmail: app?.email ?? "",
  });
}
