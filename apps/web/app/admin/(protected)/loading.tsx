/**
 * Shown immediately when navigating to any /admin/* route while the
 * client component JS chunk loads. Matches the general admin table layout.
 */
export default function AdminLoading() {
  return (
    <div className="animate-pulse">
      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <div className="h-6 w-36 rounded bg-surface-raised" />
        <div className="h-7 w-24 rounded-md bg-surface-raised" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 border-b border-border pb-px">
        {[48, 64, 72, 56].map((w, i) => (
          <div key={i} className="h-4 rounded bg-surface-raised mx-2 mb-2.5" style={{ width: w }} />
        ))}
      </div>

      {/* Search */}
      <div className="h-8 w-64 rounded-lg bg-surface-raised mb-3" />

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        {/* Header row */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-b border-border">
          {[80, 160, 64, 80].map((w, i) => (
            <div key={i} className="h-2.5 rounded bg-surface-raised" style={{ width: w }} />
          ))}
        </div>
        {/* Data rows */}
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50">
            <div className="h-6 w-6 rounded bg-surface-raised shrink-0" />
            <div className="h-3 w-40 rounded bg-surface-raised flex-1" />
            <div className="h-4 w-14 rounded-full bg-surface-raised" />
            <div className="h-3 w-20 rounded bg-surface-raised" />
          </div>
        ))}
      </div>
    </div>
  );
}
