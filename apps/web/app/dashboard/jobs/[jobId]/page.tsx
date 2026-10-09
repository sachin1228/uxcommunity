import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { BackLink } from "@/components/ui/BackLink";
import { JobDetail } from "@/components/jobs/JobDetail";
import { editedLabel, timeAgoLabel } from "@/lib/jobs/format";
import { getJobDetail, loadJobMasterData, loadJobViewer } from "@/lib/jobs/service";

export const metadata = { title: "Job — uxcommunity" };

/**
 * A posting's own page. The board's pane covers browsing; this is the stable
 * view of a single posting, and where "My posts" items open.
 */
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

  // The criteria master data is only needed by the owner's edit form, so it is
  // read only when this viewer is the poster — everyone else sees the posting
  // and no controls.
  const master = job.is_mine ? await loadJobMasterData(db) : undefined;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-6">
      <BackLink
        href={`/dashboard/jobs?job=${jobId}`}
        label="Jobs"
        className="inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground"
      />

      <div className="mt-4">
        <JobDetail
          viewer={viewer}
          master={master}
          job={{
            ...job,
            posted_label: timeAgoLabel(job.created_at),
            updated_label: editedLabel(job.created_at, job.updated_at),
            my_application: job.my_application
              ? { ...job.my_application, applied_label: timeAgoLabel(job.my_application.created_at) }
              : null,
          }}
        />
      </div>
    </div>
  );
}
