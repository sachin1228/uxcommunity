import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { jobStatusSchema } from "@/lib/jobs/validation";
import { setJobPostStatus, type SetJobStatusFailureCode } from "@/lib/jobs/service";

/**
 * Close or reopen a posting the member owns — the reversible end of a role's
 * life. Closing keeps the row, its URL, its applicants and its history while
 * it stops taking applications; deleting is the separate, irreversible route.
 */

const STATUS_FOR_FAILURE: Record<SetJobStatusFailureCode, number> = {
  job_not_found: 404,
  not_your_job: 403,
  invalid_status: 422,
  not_installed: 503,
  unexpected: 500,
};

const MESSAGE_FOR_FAILURE: Partial<Record<SetJobStatusFailureCode, string>> = {
  job_not_found: "This job no longer exists.",
  not_your_job: "Only the member who posted this job can close or reopen it.",
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

  const parsed = jobStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status." }, { status: 422 });
  }

  const { id } = await params;
  const db = createServiceClient();
  const result = await setJobPostStatus(db, {
    actorId: session.userId!,
    jobId: id,
    status: parsed.data.status,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.code,
        message: MESSAGE_FOR_FAILURE[result.code] ?? "The job could not be updated.",
      },
      { status: STATUS_FOR_FAILURE[result.code] }
    );
  }

  return NextResponse.json({ job_id: result.jobId, status: result.status });
}
