import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteFromR2, uploadToR2 } from "@/lib/r2";
import { jobApplicationSchema } from "@/lib/jobs/validation";
import { detectResumeMime, RESUME_MAX_BYTES, resumeExtension, type ResumeMime } from "@/lib/jobs/resume-file";
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // The resume is required — the modal enforces it and the boundary re-checks
  // it, so an application can never be recorded without one. A fresh upload
  // goes to R2 before the apply call and is reclaimed whenever the application
  // does not land; a saved resume (Settings → Job profile) travels as
  // `saved_resume_id` instead: its file already lives in R2, nothing is
  // uploaded here, and there is nothing to reclaim on failure.
  const resume = formData.get("resume");
  const uploadedFile = resume instanceof Blob && resume.size > 0 ? resume : null;
  const savedResumeIdEntry = formData.get("saved_resume_id");
  const savedResumeId =
    typeof savedResumeIdEntry === "string" && savedResumeIdEntry ? savedResumeIdEntry : null;

  if (!uploadedFile && !savedResumeId) {
    return NextResponse.json(
      { error: "resume_required", message: "Attach a resume to apply." },
      { status: 422 }
    );
  }

  const db = createServiceClient();
  let resumeUrl: string | null = null;
  let resumeKey: string | null = null;
  // Set only on the fresh-upload path — the first-upload adoption below needs
  // the original file's name, detected mime and size.
  let uploadedResume: { name: string; mime: ResumeMime; size: number } | null = null;

  if (uploadedFile) {
    if (uploadedFile.size > RESUME_MAX_BYTES) {
      return NextResponse.json({ error: "Resume exceeds the 5 MB limit." }, { status: 413 });
    }

    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
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

    uploadedResume = {
      name: uploadedFile instanceof File ? uploadedFile.name.trim() : "",
      mime,
      size: uploadedFile.size,
    };
  } else if (savedResumeId) {
    if (!UUID_RE.test(savedResumeId)) {
      return NextResponse.json(
        { error: "invalid_resume_url", message: "That saved resume is no longer available. Pick another." },
        { status: 422 }
      );
    }

    // Scoped to the applicant: someone else's resume id resolves to
    // nothing and fails the same way a deleted one does.
    const { data: savedResume } = await db
      .from("member_resumes")
      .select("url")
      .eq("id", savedResumeId)
      .eq("user_id", session.userId!)
      .maybeSingle();

    if (!savedResume) {
      return NextResponse.json(
        { error: "invalid_resume_url", message: "That saved resume is no longer available. Pick another." },
        { status: 422 }
      );
    }

    resumeUrl = savedResume.url;
  }

  const { id } = await params;
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

  // First-upload adoption: when a member with no saved resumes attaches a
  // one-off file, that file becomes their first saved resume, so the next
  // Apply offers it and Settings → Job profile lists it. Members who already
  // have a saved list manage it themselves — their one-off uploads stay
  // one-off. Non-fatal by design: the application already landed, so a
  // failure here is only logged.
  if (uploadedResume && resumeUrl) {
    try {
      const { count, error: countError } = await db
        .from("member_resumes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", session.userId!);

      if (countError) throw countError;

      if ((count ?? 0) === 0) {
        const { error: insertError } = await db.from("member_resumes").insert({
          user_id: session.userId!,
          file_name: uploadedResume.name || `resume.${resumeExtension(uploadedResume.mime)}`,
          mime_type: uploadedResume.mime,
          size_bytes: uploadedResume.size,
          url: resumeUrl,
          is_default: true,
        });

        if (insertError) throw insertError;
      }
    } catch (error) {
      console.error("[jobs/apply] resume adopt error:", error);
    }
  }

  return NextResponse.json({ application_id: result.applicationId });
}
