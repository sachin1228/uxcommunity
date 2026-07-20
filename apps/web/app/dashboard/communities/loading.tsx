/**
 * Shown immediately when navigating to /dashboard/communities while the
 * client component bundle loads or the explore data is being fetched.
 * Matches the Explore Communities page layout exactly.
 */
export default function CommunitiesLoading() {
  return (
    <div className="flex flex-col h-full animate-pulse">
      {/* Header */}
      <div className="px-6 pt-6 pb-0 shrink-0">
        <div className="h-6 w-48 rounded bg-surface-raised mb-4" />

        {/* Search bar */}
        <div className="h-9 w-full rounded-lg bg-surface-raised mb-4" />

        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-border pb-px">
          {[64, 48, 72, 72, 80, 48].map((w, i) => (
            <div key={i} className={`h-4 w-${w === 48 ? 12 : w === 64 ? 16 : w === 72 ? 18 : 20} rounded bg-surface-raised mx-2 mb-2.5`} />
          ))}
        </div>
      </div>

      {/* List rows */}
      <div className="flex-1 overflow-hidden">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-6 py-3 border-b border-border/50">
            <div className="h-10 w-10 rounded-full bg-surface-raised shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-36 rounded bg-surface-raised" />
              <div className="h-2.5 w-20 rounded bg-surface-raised" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
