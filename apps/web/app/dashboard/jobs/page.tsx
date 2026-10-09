import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { JobsBrowser } from "@/components/jobs/JobsBrowser";
import { timeAgoLabel } from "@/lib/jobs/format";
import { getJobFeed, loadJobMasterData, loadJobViewer } from "@/lib/jobs/service";

export const metadata = { title: "Jobs — uxcommunity" };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();
  if (!session || session.role !== "user") {
    redirect("/login");
  }

  const db = createServiceClient();
  const viewer = await loadJobViewer(db, session.userId!);
  if (!viewer) {
    redirect("/login");
  }

  const [query, jobs, master] = await Promise.all([
    searchParams,
    getJobFeed(db, viewer.id),
    loadJobMasterData(db),
  ]);

  return (
    <JobsBrowser
      viewer={viewer}
      master={master}
      jobs={jobs.map((job) => ({
        ...job,
        posted_label: timeAgoLabel(job.created_at),
        my_application: job.my_application
          ? { ...job.my_application, applied_label: timeAgoLabel(job.my_application.created_at) }
          : null,
      }))}
      initialJobId={typeof query.job === "string" ? query.job : null}
    />
  );
}
