import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { jobPostUpdateSchema } from "@/lib/jobs/validation";
import { updateJobPost, type UpdateJobFailureCode } from "@/lib/jobs/service";

/**
 * Save an edit to a posting the member owns.
 *
 * `kind` and `company_id` are deliberately absent — the post type and the
 * verified company are the proof the posting was made under, and changing
 * either one is a new posting rather than an edit. The route carries the same
 * session-user convention as every other job write: the actor id is the
 * session, and `update_job_post` re-checks that the posting is theirs.
 */

const STATUS_FOR_FAILURE: Record<UpdateJobFailureCode, number> = {
  job_not_found: 404,
  not_your_job: 403,
  criteria_locked: 409,
  invalid_title: 422,
  missing_description: 422,
  invalid_work_mode: 422,
  invalid_employment_type: 422,
  invalid_city: 422,
  invalid_sector: 422,
  invalid_job_title: 422,
  invalid_experience_level: 422,
  invalid_website: 422,
  not_installed: 503,
  unexpected: 500,
};

const MESSAGE_FOR_FAILURE: Partial<Record<UpdateJobFailureCode, string>> = {
  job_not_found: "This job no longer exists.",
  not_your_job: "Only the member who posted this job can edit it.",
  criteria_locked:
    "The city, sector, job title and experience level are locked once a job has applications — they decide who can apply.",
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = jobPostUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const data = parsed.data;
  const { id } = await params;
  const db = createServiceClient();
  const result = await updateJobPost(db, {
    actorId: session.userId!,
    jobId: id,
    title: data.title,
    cityId: data.city_id,
    sectorId: data.sector_id,
    jobTitle: data.job_title,
    experienceLevel: data.experience_level,
    workMode: data.work_mode,
    employmentType: data.employment_type,
    salary: data.salary ? data.salary : null,
    description: data.description,
    // Absent means "leave the stored list alone": the edit form does not
    // manage the list fields, and a save must not blank what it never showed.
    responsibilities: data.responsibilities ?? null,
    requirements: data.requirements ?? null,
    skills: data.skills ?? null,
    website: data.website ? data.website : null,
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

  return NextResponse.json({ job_id: result.jobId, edited_at: result.editedAt });
}
