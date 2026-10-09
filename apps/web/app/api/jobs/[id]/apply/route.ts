import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteFromR2, uploadToR2 } from "@/lib/r2";
import { jobApplicationSchema } from "@/lib/jobs/validation";
import { detectResumeMime, RESUME_MAX_BYTES, resumeExtension } from "@/lib/jobs/resume-file";
import { applyToJob, type ApplyFailureCode } from "@/lib/jobs/service";

const STATUS_FOR_FAILURE: Record<ApplyFailureCode, number> = {
  job_not_found: 404,
  unknown_user: 401,
  own_job: 409,
  job_closed: 409,
  job_expired: 409,
  invalid_name: 422,
  invalid_portfolio_url: 422,
  invalid_linkedin_url: 422,
  invalid_resume_url: 422,
  not_eligible: 403,
  already_applied: 409,
  not_installed: 503,
  unexpected: 500,
};

const MESSAGE_FOR_FAILURE: Partial<Record<ApplyFailureCode, string>> = {
  job_not_found: "This job no longer exists.",
  own_job: "You posted this job.",
  job_closed: "This posting is closed — it is no longer accepting applications.",
  job_expired: "This posting’s closing date has passed — it is no longer accepting applications.",
  not_eligible:
    "This job is only open to members whose city, sector, job title and experience level match the posting.",
  already_applied: "You have already applied to this job.",
  not_installed: "Jobs are not available right now.",
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "An application form is required." }, { status: 415 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const parsed = jobApplicationSchema.safeParse({
    name: formData.get("name"),
    portfolio_url: formData.get("portfolio_url"),
    linkedin_url: formData.get("linkedin_url"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  // The resume is optional; when present it goes to R2 before the apply
  // call, and is reclaimed whenever the application does not land.
  let resumeUrl: string | null = null;
  let resumeKey: string | null = null;
  const resume = formData.get("resume");
  if (resume && resume instanceof Blob && resume.size > 0) {
    if (resume.size > RESUME_MAX_BYTES) {
      return NextResponse.json({ error: "Resume exceeds the 5 MB limit." }, { status: 413 });
    }

    const buffer = Buffer.from(await resume.arrayBuffer());
    const mime = detectResumeMime(buffer);
    if (!mime) {
      return NextResponse.json(
        { error: "Attach a PDF, DOC, DOCX or RTF resume." },
        { status: 422 }
      );
    }

    resumeKey = `resumes/${session.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${resumeExtension(mime)}`;
    try {
      resumeUrl = await uploadToR2(resumeKey, buffer, mime);
    } catch (error) {
      console.error("[jobs/apply] resume upload error:", error);
      return NextResponse.json({ error: "Resume upload failed. Please try again." }, { status: 500 });
    }
  }

  const { id } = await params;
  const db = createServiceClient();
  const result = await applyToJob(db, {
    jobId: id,
    applicantId: session.userId!,
    name: parsed.data.name,
    portfolioUrl: parsed.data.portfolio_url,
    linkedinUrl: parsed.data.linkedin_url,
    resumeUrl,
  });

  if (!result.ok) {
    if (resumeKey) {
      try {
        await deleteFromR2(resumeKey);
      } catch (cleanupError) {
        console.error("[jobs/apply] resume cleanup error:", cleanupError);
      }
    }

    return NextResponse.json(
      {
        error: result.code,
        message: MESSAGE_FOR_FAILURE[result.code] ?? "Your application could not be sent.",
      },
      { status: STATUS_FOR_FAILURE[result.code] }
    );
  }

  return NextResponse.json({ application_id: result.applicationId });
}
