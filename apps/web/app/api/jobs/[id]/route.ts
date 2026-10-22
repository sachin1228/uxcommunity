import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { formatJobFeedRows } from "@/lib/jobs/format";
import { deleteJobPost, getJobDetail, type DeleteJobFailureCode } from "@/lib/jobs/service";

/**
 * Read one posting, or delete one the member owns.
 *
 * The GET is the mobile client's stable view of a single posting — the same
 * server-computed payload and labels the board renders — so a role survives a
 * reload or a deep link without re-reading the whole feed. The DELETE is
 * permanent: the applications cascade with the row; the resume objects stay in
 * R2 for the orphan audit. Closing (`/api/jobs/<id>/status`) is the reversible
 * alternative, so the client only reaches for this after naming the
 * consequences.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  const db = createServiceClient();
  const job = await getJobDetail(db, session.userId!, id);

  if (!job) {
    return NextResponse.json(
      { error: "job_not_found", message: "This job no longer exists." },
      { status: 404 }
    );
  }

  return NextResponse.json({ job: formatJobFeedRows([job])[0] });
}

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
