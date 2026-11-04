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

/**
 * Reserves the same desktop column as the homepage while its server data
 * loads. Both cards wear the real rail cards' overlay surface — dark with the
 * top glow — so the takeover hands off to CreateCommunityCard and
 * CommunityPhoneCard without the rail repainting.
 */
export function HomeSidebarSkeleton() {
  return (
    <aside aria-label="Homepage suggestions" className="hidden w-72 shrink-0 flex-col gap-4 self-stretch pt-8 xl:flex">
      <div role="status" aria-label="Loading homepage cards" className="space-y-4">
        <span className="sr-only">Loading homepage cards</span>
        <div aria-hidden="true" className="space-y-4">
          {/* CreateCommunityCard: title, full-width pill, edge-to-edge crowd. */}
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-overlay shadow-sm">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(58%_100%_at_50%_0%,rgba(255,255,255,0.12),transparent_72%)]" />
            <div className="relative px-4 pt-5 text-center motion-safe:animate-pulse">
              <div className="mx-auto mb-3 h-4 w-48 rounded bg-white/15" />
              <div className="mb-4 h-9 w-full rounded-full bg-overlay-foreground" />
            </div>
            <div className="relative h-36 bg-white/[0.08] motion-safe:animate-pulse" />
          </div>

          {/* CommunityPhoneCard: heading, two-line lede, dimmed pill, phone
              rising out of the bottom edge. */}
          <div className="relative h-[432px] overflow-hidden rounded-xl border border-white/10 bg-overlay">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(255,255,255,0.10),transparent_72%)]" />
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.09] [mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_70%,transparent)]"
              aria-hidden="true"
            >
              <defs>
                <pattern id="home-skeleton-grid" width="48" height="48" patternUnits="userSpaceOnUse">
                  <path d="M48 0H0V48" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 4" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#home-skeleton-grid)" />
            </svg>
            <div className="relative motion-safe:animate-pulse">
              <div className="mx-auto mt-5 h-4 w-44 rounded bg-white/15" />
              <div className="mx-auto mt-3 w-[248px] space-y-[7px]">
                <div className="mx-auto h-3 w-40 rounded bg-white/10" />
                <div className="mx-auto h-3 w-32 rounded bg-white/10" />
              </div>
              <div className="mx-auto mt-4 h-9 w-44 rounded-full bg-white/60" />
            </div>
            <div
              className="pointer-events-none absolute left-1/2 top-[168px] h-[264px] w-[228px] -translate-x-1/2 bg-white/[0.07] motion-safe:animate-pulse [mask-image:linear-gradient(to_bottom,#000_calc(100%-52px),transparent)]"
              style={{ borderRadius: "40px 40px 0 0" }}
            />
          </div>
        </div>
      </div>
      <SuggestedCommunitiesSkeleton />
    </aside>
  );
}
