import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { formatJobFeedRows } from "@/lib/jobs/format";
import {
  deleteJobPost,
  getJobDetail,
  type DeleteJobFailureCode,
} from "@/lib/jobs/service";

/**
 * Single job posting — the JSON read the mobile app's job detail needs (the
 * web page reads the same RPC server-side). Same payload and labels as the
 * feed (`formatJobFeedRows`), so a card and its detail arrive with identical
 * `*_label` fields. Any signed-in member with the id can open it, exactly
 * like the web detail page; the payload's `is_mine` / `applied` / `can_apply`
 * flags carry the viewer-specific state.
 *
 * DELETE removes a posting the member owns — permanently. The applications
 * cascade with the row; the resume objects stay in R2 for the orphan audit.
 * Closing (`/api/jobs/<id>/status`) is the reversible alternative, so the
 * client only reaches for this after naming the consequences.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function jobNotFound() {
  return NextResponse.json(
    { error: "job_not_found", message: "This job no longer exists." },
    { status: 404 }
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) return jobNotFound();

  const db = createServiceClient();
  const job = await getJobDetail(db, session.userId!, id);
  if (!job) return jobNotFound();

  return NextResponse.json({ job: formatJobFeedRows([job])[0] });
}

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
