import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { BackLink } from "@/components/ui/BackLink";
import { JobDetail } from "@/components/jobs/JobDetail";
import { formatJobFeedRows } from "@/lib/jobs/format";
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

  // The same label pass the board's rows go through — this page renders the
  // posting in full, so it hands `JobDetail` the prose AND the labels, and the
  // pane fills the same sections in from its own read.
  const [posting] = formatJobFeedRows([job]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-6">
      <BackLink
        href={`/dashboard/jobs?job=${jobId}`}
        label="Jobs"
        className="inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground"
      />

      <div className="mt-4">
        <JobDetail viewer={viewer} master={master} job={posting} />
      </div>
    </div>
  );
}
