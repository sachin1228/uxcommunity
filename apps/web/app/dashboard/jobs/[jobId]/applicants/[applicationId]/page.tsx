import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { DesignModeViewer } from "@/components/jobs/DesignModeViewer";
import { timeAgoLabel } from "@/lib/jobs/format";
import {
  getJobApplicants,
  getJobDetail,
  loadJobApplicantDetails,
  loadJobViewer,
} from "@/lib/jobs/service";

export const metadata = { title: "Application — uxcommunity" };

/**
 * One applicant's application, as the design view renders it — the page the
 * board's design-mode card opens. The applicant is pinned by the URL (the
 * last segment is the application id), which is what previous/next walk.
 * The payload the viewer needs (profile facts the SQL does not carry) is
 * resolved here, the same way the applicants board would.
 */
export default async function ApplicantDesignPage({
  params,
}: {
  params: Promise<{ jobId: string; applicationId: string }>;
}) {
  const session = await getSession();
  if (!session || session.role !== "user") {
    redirect("/login");
  }

  const { jobId, applicationId } = await params;
  const db = createServiceClient();
  const viewer = await loadJobViewer(db, session.userId!);
  if (!viewer) {
    redirect("/login");
  }

  const job = await getJobDetail(db, viewer.id, jobId);
  if (!job) {
    notFound();
  }
  if (!job.is_mine) {
    redirect(`/dashboard/jobs/${jobId}`);
  }

  const result = await getJobApplicants(db, viewer.id, jobId);
  if (!result.ok) {
    // Not the poster's posting, or the list failed to load — the board is
    // the surface that knows how to say either.
    redirect(`/dashboard/jobs/${jobId}/applicants`);
  }

  const applicants = await loadJobApplicantDetails(
    db,
    result.applicants.map((applicant) => ({
      ...applicant,
      applied_label: timeAgoLabel(applicant.created_at),
    }))
  );

  // The application the URL names must still exist — a deleted one sends the
  // poster back to the list rather than a page that cannot say who it is.
  if (!applicants.some((applicant) => applicant.id === applicationId)) {
    redirect(`/dashboard/jobs/${jobId}/applicants`);
  }

  return (
    <DesignModeViewer jobId={jobId} applicants={applicants} currentId={applicationId} />
  );
}
