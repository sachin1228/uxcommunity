import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { formatJobFeedRows } from "@/lib/jobs/format";
import { deleteJobPost, getJobDetail, type DeleteJobFailureCode } from "@/lib/jobs/service";

/**
 * One posting.
 *
 * GET is the board's detail read. `get_job_feed` returns CARD rows — the
 * posting minus its three prose fields — so the pane fetches the posting it is
 * about to show, once per posting per session, and keeps it. Nothing new is
 * exposed by this: it is the same read (`get_job_detail`), under the same
 * session check, that the posting's own page has always performed, and the
 * pane only ever asks for an id the feed just handed it.
 *
 * DELETE removes a posting the member owns — permanently. The applications
 * cascade with the row; the resume objects stay in R2 for the orphan audit.
 * Closing (`/api/jobs/<id>/status`) is the reversible alternative, so the
 * client only reaches for this after naming the consequences.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // The id arrives from a route the client owns, but it is now used as an RPC
  // argument, so it is checked rather than trusted: a malformed id would make
  // Postgres raise on the uuid cast instead of answering "no such posting".
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Posting not found." }, { status: 404 });
  }

  const db = createServiceClient();
  const job = await getJobDetail(db, session.userId!, id);
  if (!job) {
    return NextResponse.json({ error: "Posting not found." }, { status: 404 });
  }

  // The same label pass the board's first paint gets, so a posting read here
  // and the same posting read from the RSC page print identical strings.
  const [row] = formatJobFeedRows([job]);
  return NextResponse.json({ job: row });
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
