import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { BackLink } from "@/components/ui/BackLink";
import { PostJobForm } from "@/components/jobs/PostJobForm";
import { loadJobMasterData, loadJobViewer } from "@/lib/jobs/service";

export const metadata = { title: "Post a job — uxcommunity" };

/**
 * Posting a job, as a page rather than a dialog.
 *
 * The form is the longest one in the app — a rich description, two post types,
 * the company proof and seven role fields — and a panel that scrolls inside a
 * scroll hides exactly the kind of mistake (a missing criterion, a lost
 * description) that the form is trying to prevent. As a page it gets the full
 * height, a member can leave to fetch text and come back, and a reload does not
 * throw the work away.
 *
 * It is a static route, so it wins over `/dashboard/jobs/[jobId]` — a job id is
 * a uuid, and `new` is never one.
 *
 * The signed-in check is the page's own, because this URL can be typed or
 * bookmarked; the form itself trusts nothing, and the database re-checks the
 * membership and the master data on the write.
 *
 * The form arrives as three cards of its own, so the page holds no frame around
 * it: the groups are the shape, and a card inside a card would only add chrome.
 */
export default async function NewJobPage() {
  const session = await getSession();
  if (!session || session.role !== "user") {
    redirect("/login");
  }

  const db = createServiceClient();
  const viewer = await loadJobViewer(db, session.userId!);
  if (!viewer) {
    redirect("/login");
  }

  const master = await loadJobMasterData(db);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-6">
      <BackLink
        href="/dashboard/jobs"
        label="Jobs"
        className="inline-flex items-center gap-1.5 font-body text-sm text-foreground-muted transition-colors hover:text-foreground"
      />

      <div className="mt-4">
        <h1 className="font-display text-2xl font-semibold text-foreground">Post a job</h1>
        <p className="mt-1 font-body text-sm text-foreground-muted">
          A role at a company verified with a work email. Only members whose profile matches the
          four criteria you choose can apply.
        </p>
      </div>

      <div className="mt-5">
        <PostJobForm viewer={viewer} master={master} />
      </div>
    </div>
  );
}
