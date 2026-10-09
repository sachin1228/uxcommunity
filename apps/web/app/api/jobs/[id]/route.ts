import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteJobPost, type DeleteJobFailureCode } from "@/lib/jobs/service";

/**
 * Delete a posting the member owns — permanently. The applications cascade
 * with the row; the resume objects stay in R2 for the orphan audit. Closing
 * (`/api/jobs/<id>/status`) is the reversible alternative, so the client only
 * reaches for this after naming the consequences.
 */

const STATUS_FOR_FAILURE: Record<DeleteJobFailureCode, number> = {
  job_not_found: 404,
  not_your_job: 403,
  not_installed: 503,
  unexpected: 500,
};

const MESSAGE_FOR_FAILURE: Partial<Record<DeleteJobFailureCode, string>> = {
  job_not_found: "This job no longer exists.",
  not_your_job: "Only the member who posted this job can delete it.",
  not_installed: "Jobs are not available right now.",
};

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  const db = createServiceClient();
  const result = await deleteJobPost(db, { actorId: session.userId!, jobId: id });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.code,
        message: MESSAGE_FOR_FAILURE[result.code] ?? "The job could not be deleted.",
      },
      { status: STATUS_FOR_FAILURE[result.code] }
    );
  }

  return NextResponse.json({ job_id: result.jobId });
}
