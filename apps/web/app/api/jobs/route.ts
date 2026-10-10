import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { jobPostSchema } from "@/lib/jobs/validation";
import { deferJobMatchNotifications } from "@/lib/jobs/notifications";
import { createJobPost, type CreateJobFailureCode } from "@/lib/jobs/service";

const STATUS_FOR_FAILURE: Record<CreateJobFailureCode, number> = {
  unknown_user: 401,
  invalid_kind: 422,
  invalid_title: 422,
  missing_description: 422,
  invalid_work_mode: 422,
  invalid_employment_type: 422,
  company_inactive: 409,
  company_not_verified: 409,
  invalid_city: 422,
  invalid_sector: 422,
  invalid_job_title: 422,
  invalid_experience_level: 422,
  invalid_website: 422,
  not_installed: 503,
  unexpected: 500,
};

const MESSAGE_FOR_FAILURE: Partial<Record<CreateJobFailureCode, string>> = {
  unknown_user: "Sign in again to post a job.",
  company_not_verified:
    "A job can only be posted for a company you have verified with a work email.",
  company_inactive: "That company is no longer active.",
  not_installed: "Jobs are not available right now.",
};

export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = jobPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const data = parsed.data;
  const db = createServiceClient();
  const result = await createJobPost(db, {
    posterId: session.userId!,
    kind: data.kind,
    companyId: data.company_id,
    title: data.title,
    cityId: data.city_id,
    sectorId: data.sector_id,
    jobTitle: data.job_title,
    experienceLevel: data.experience_level,
    workMode: data.work_mode,
    employmentType: data.employment_type,
    salary: data.salary ? data.salary : null,
    description: data.description,
    responsibilities: data.responsibilities ?? [],
    requirements: data.requirements ?? [],
    skills: data.skills ?? [],
    website: data.website ? data.website : null,
    // Already the instant, converted by the schema's transform.
    closesAt: data.closes_at,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.code,
        message: MESSAGE_FOR_FAILURE[result.code] ?? "Review the job details and try again.",
      },
      { status: STATUS_FOR_FAILURE[result.code] }
    );
  }

  // Everyone the role matches hears about it — deferred past this response,
  // best effort: the posting stands even if the fan-out misses.
  deferJobMatchNotifications(result.jobId, session.userId!);

  return NextResponse.json({ job_id: result.jobId });
}
