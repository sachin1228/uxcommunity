import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { JobDetail } from "@/components/jobs/JobDetail";
import { timeAgoLabel } from "@/lib/jobs/format";
import { getJobDetail, loadJobViewer } from "@/lib/jobs/service";

export const metadata = { title: "Job — uxcommunity" };

export default async function JobDetailPage({
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

  return (
    <JobDetail
      viewer={viewer}
      job={{
        ...job,
        posted_label: timeAgoLabel(job.created_at),
        my_application: job.my_application
          ? { ...job.my_application, applied_label: timeAgoLabel(job.my_application.created_at) }
          : null,
      }}
    />
  );
}
