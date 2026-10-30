import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { JobsBrowser } from "@/components/jobs/JobsBrowser";
import { formatJobFeedRows } from "@/lib/jobs/format";
import { JOB_FEED_PAGE_SIZE, loadJobMasterData, loadJobViewer, getJobFeed } from "@/lib/jobs/service";
import { withWebJobResumePath } from "@/lib/jobs/private-resume";

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
    // One extra row: its presence is how the board knows a cursor page exists.
    getJobFeed(db, viewer.id, { limit: JOB_FEED_PAGE_SIZE + 1 }),
    loadJobMasterData(db),
  ]);

  const hasMore = jobs.length > JOB_FEED_PAGE_SIZE;
  const firstPage = hasMore ? jobs.slice(0, JOB_FEED_PAGE_SIZE) : jobs;

  return (
    <JobsBrowser
      viewer={viewer}
      master={master}
      initialJobs={formatJobFeedRows(firstPage).map(withWebJobResumePath)}
      initialHasMore={hasMore}
      initialJobId={typeof query.job === "string" ? query.job : null}
    />
  );
}
