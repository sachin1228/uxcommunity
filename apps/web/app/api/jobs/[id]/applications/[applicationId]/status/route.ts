import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { applicationStatusSchema } from "@/lib/jobs/validation";
import {
  setJobApplicationStatus,
  type SetApplicationStatusFailureCode,
} from "@/lib/jobs/service";

/**
 * The poster's triage of one application on their posting — shortlist, reject,
 * or move back to new. Every state is reversible: a rejection is a decision,
 * not a deletion. The database re-checks the poster through the application's
 * own job, so this route only passes the session user id.
 */

const STATUS_FOR_FAILURE: Record<SetApplicationStatusFailureCode, number> = {
  application_not_found: 404,
  not_your_job: 403,
  invalid_status: 422,
  not_installed: 503,
  unexpected: 500,
};

const MESSAGE_FOR_FAILURE: Partial<Record<SetApplicationStatusFailureCode, string>> = {
  application_not_found: "This application no longer exists.",
  not_your_job: "Only the member who posted this job can review its applicants.",
  not_installed: "Jobs are not available right now.",
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; applicationId: string }> }
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

  const parsed = applicationStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status." }, { status: 422 });
  }

  const { applicationId } = await params;
  const db = createServiceClient();
  const result = await setJobApplicationStatus(db, {
    actorId: session.userId!,
    applicationId,
    status: parsed.data.status,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.code,
        message: MESSAGE_FOR_FAILURE[result.code] ?? "The application could not be updated.",
      },
      { status: STATUS_FOR_FAILURE[result.code] }
    );
  }

  return NextResponse.json({ application_id: result.applicationId, status: result.status });
}
