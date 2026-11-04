import { DashboardSingleColumn } from "./ContentLoader";
import { HomeSidebarSkeleton } from "./HomeSidebarSkeleton";

export function FeedSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[40rem] space-y-4 px-4 pt-8" role="status" aria-label="Loading feed">
      <span className="sr-only">Loading your feed</span>
      <div aria-hidden className="motion-safe:animate-pulse space-y-4">
        <div className="h-8 w-40 rounded-md bg-surface-raised" />
        {[0, 1].map(i => <div key={i} className="h-56 rounded-xl border border-border bg-surface" />)}
      </div>
    </div>
  );
}

/** Matches the homepage's feed and desktop suggestions columns during streaming. */
export function HomeFeedSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl items-start justify-center gap-6 px-4 lg:px-6">
      <DashboardSingleColumn><FeedSkeleton /></DashboardSingleColumn>
      <HomeSidebarSkeleton />
    </div>
  );
}
