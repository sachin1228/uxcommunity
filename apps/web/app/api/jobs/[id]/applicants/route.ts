import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { formatJobFeedRows, timeAgoLabel } from "@/lib/jobs/format";
import {
  getJobApplicants,
  getJobDetail,
  loadJobApplicantDetails,
} from "@/lib/jobs/service";

/**
 * The poster's applicant list for one posting — the mobile applicants board's
 * read. It carries the posting itself (so the board's summary card and the
 * design view need no second request) and each application exactly as the web
 * board renders it: the submitted links, the triage standing, and the profile
 * facts (role label, city) the design view's sidebar shows.
 *
 * The database re-checks that the posting is the session member's; this route
 * only maps its answer onto a status.
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

  const result = await getJobApplicants(db, session.userId!, id);

  if (!result.ok) {
    if (result.code === "not_your_job") {
      return NextResponse.json(
        {
          error: result.code,
          message: "Only the member who posted this job can review its applicants.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        error: result.code,
        message:
          result.code === "not_installed"
            ? "Jobs are not available right now."
            : "The applicants could not be loaded.",
      },
      { status: result.code === "not_installed" ? 503 : 500 }
    );
  }

  const applicants = await loadJobApplicantDetails(
    db,
    result.applicants.map((applicant) => ({
      ...applicant,
      applied_label: timeAgoLabel(applicant.created_at),
    }))
  );

  return NextResponse.json({
    job: formatJobFeedRows([job])[0],
    applicants,
  });
}
