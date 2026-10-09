import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { ApplicantsBoard } from "@/components/jobs/ApplicantsBoard";
import { editedLabel, timeAgoLabel } from "@/lib/jobs/format";
import { getJobApplicants, getJobDetail, loadJobViewer } from "@/lib/jobs/service";

export const metadata = { title: "Applicants — uxcommunity" };

export default async function JobApplicantsPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const session = await getSession();
  if (!session || session.role !== "user") {
    redirect("/login");
  }

  const { jobId } = await params;
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
    if (result.code === "not_your_job") {
      redirect(`/dashboard/jobs/${jobId}`);
    }
    // The list failed to load (e.g. the migration is not installed); render
    // the board empty rather than a broken page — the error is logged.
    return (
      <ApplicantsBoard
        job={{
          ...job,
          posted_label: timeAgoLabel(job.created_at),
          updated_label: editedLabel(job.created_at, job.updated_at),
        }}
        applicants={[]}
      />
    );
  }

  return (
    <ApplicantsBoard
      job={{
        ...job,
        posted_label: timeAgoLabel(job.created_at),
        updated_label: editedLabel(job.created_at, job.updated_at),
      }}
      applicants={result.applicants.map((applicant) => ({
        ...applicant,
        applied_label: timeAgoLabel(applicant.created_at),
      }))}
    />
  );
}
