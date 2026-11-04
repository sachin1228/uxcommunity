import { DashboardSingleColumn } from "./ContentLoader";
import { HomeSidebarSkeleton } from "./HomeSidebarSkeleton";

/**
 * Feed-column placeholders cut from the real page's geometry: the filter
 * switcher's track with its active pill, then cards wearing the shared feed
 * card shell (rounded-xl border, px-5/6 py-5) with an author row, body lines
 * and the count-only footer. One text-only card, one with an attachment block.
 */
export function FeedSkeleton() {
  return (
    <div className="w-full" role="status" aria-label="Loading feed">
      <span className="sr-only">Loading your feed</span>
      <div aria-hidden="true">
        <div className="flex items-center justify-center px-4 py-3 md:px-5 md:py-4">
          <div className="fb-filter-track flex items-center gap-0.5 rounded-xl p-1">
            <div className="fb-filter-pill h-9 w-28 rounded-lg" />
            <div className="flex h-9 w-36 items-center justify-center rounded-lg">
              <div className="h-2.5 w-20 rounded bg-surface-raised" />
            </div>
          </div>
        </div>

        <div className="space-y-4 motion-safe:animate-pulse">
          {/* Text-only card — five body lines, the collapsed thread clamp. */}
          <div className="overflow-hidden rounded-xl border border-border bg-background-subtle px-5 py-5 md:px-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-surface-raised" />
              <div className="min-w-0 flex-1">
                <div className="mb-[5px] h-[14px] w-28 rounded bg-surface-raised" />
                <div className="h-[11px] w-16 rounded bg-surface-raised" />
              </div>
            </div>
            <div className="mt-4 space-y-[11px]">
              <div className="h-[13px] w-full rounded bg-surface-raised" />
              <div className="h-[13px] w-[92%] rounded bg-surface-raised" />
              <div className="h-[13px] w-[85%] rounded bg-surface-raised" />
              <div className="h-[13px] w-[64%] rounded bg-surface-raised" />
              <div className="h-[13px] w-[40%] rounded bg-surface-raised" />
            </div>
            <div className="mt-5 flex items-center gap-6">
              <div className="h-[14px] w-10 rounded bg-surface-raised" />
              <div className="h-[14px] w-10 rounded bg-surface-raised" />
            </div>
          </div>

          {/* Card with an attachment — two lines, then the media block. */}
          <div className="overflow-hidden rounded-xl border border-border bg-background-subtle px-5 py-5 md:px-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-surface-raised" />
              <div className="min-w-0 flex-1">
                <div className="mb-[5px] h-[14px] w-24 rounded bg-surface-raised" />
                <div className="h-[11px] w-16 rounded bg-surface-raised" />
              </div>
            </div>
            <div className="mt-4 space-y-[11px]">
              <div className="h-[13px] w-[88%] rounded bg-surface-raised" />
              <div className="h-[13px] w-[55%] rounded bg-surface-raised" />
            </div>
            <div className="mt-4 h-44 rounded-lg bg-surface-raised" />
            <div className="mt-5 flex items-center gap-6">
              <div className="h-[14px] w-10 rounded bg-surface-raised" />
              <div className="h-[14px] w-10 rounded bg-surface-raised" />
            </div>
          </div>
        </div>
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
