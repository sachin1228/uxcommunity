export function SuggestedCommunitiesSkeleton() {
  return (
    <div role="status" aria-label="Loading suggested communities" className="rounded-xl border border-border bg-background-subtle p-4">
      <span className="sr-only">Loading suggested communities</span>
      <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
        <div className="h-4 w-40 rounded bg-surface-raised" />
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-9 w-9 shrink-0 rounded-full bg-surface-raised" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 rounded bg-surface-raised" />
              <div className="h-2 w-16 rounded bg-surface-raised" />
            </div>
            <div className="h-6 w-12 rounded-full bg-surface-raised" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Reserves the same desktop column as the homepage while its server data loads. */
export function HomeSidebarSkeleton() {
  return (
    <aside aria-label="Homepage suggestions" className="hidden w-72 shrink-0 flex-col gap-4 self-stretch pt-8 xl:flex">
      <div role="status" aria-label="Loading homepage cards" className="space-y-4">
        <span className="sr-only">Loading homepage cards</span>
        <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
          <div className="rounded-xl border border-border bg-background-subtle p-4">
            <div className="mx-auto h-4 w-48 rounded bg-surface-raised" />
            <div className="mt-4 h-9 rounded-full bg-surface-raised" />
            <div className="mt-4 h-36 rounded-lg bg-surface-raised" />
          </div>
          <div className="h-[432px] rounded-xl border border-border bg-background-subtle p-4">
            <div className="mx-auto h-4 w-40 rounded bg-surface-raised" />
            <div className="mx-auto mt-4 h-3 w-52 rounded bg-surface-raised" />
            <div className="mx-auto mt-8 h-72 w-48 rounded-t-3xl bg-surface-raised" />
          </div>
        </div>
      </div>
      <SuggestedCommunitiesSkeleton />
    </aside>
  );
}
