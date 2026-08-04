/**
 * Shown immediately when navigating to /dashboard while the server component
 * resolves its session + DB fetch. Mirrors the homepage two-column layout.
 */
export default function DashboardLoading() {
  return (
    <div className="flex items-start h-full animate-pulse">
      {/* ── Main feed column ── */}
      <div className="flex-1 min-w-0 border-r border-border">
        {/* Welcome heading */}
        <div className="p-6">
          <div className="h-8 w-56 rounded bg-surface-raised" />
        </div>

        <ul className="border-t border-border">
          {/* Full-width thread/event skeleton rows */}
          {[1, 2, 3].map((item) => (
            <li key={item} className="border-b border-border px-6 py-6">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 shrink-0 rounded-full bg-surface-raised" />
                <div className="flex items-center gap-2">
                  <div className="h-3 w-20 rounded bg-surface-raised" />
                  <div className="h-3 w-12 rounded bg-surface-raised" />
                  <div className="h-5 w-16 rounded-full bg-surface-raised" />
                </div>
              </div>
              <div className="mt-4 h-4 w-3/4 rounded bg-surface-raised" />
              <div className="mt-2.5 space-y-2">
                <div className="h-3 w-full rounded bg-surface-raised" />
                <div className="h-3 w-5/6 rounded bg-surface-raised" />
                <div className="h-3 w-2/3 rounded bg-surface-raised" />
              </div>
              <div className="mt-4 flex items-center gap-4">
                <div className="h-8 w-8 rounded-full bg-surface-raised" />
                <div className="h-3 w-6 rounded bg-surface-raised" />
                <div className="h-3 w-20 rounded bg-surface-raised" />
              </div>
            </li>
          ))}

          {/* 2-col article grid skeleton row */}
          <li className="border-b border-border">
            <div className="grid grid-cols-2 gap-4 p-4">
              {[1, 2].map((item) => (
                <div key={item} className="rounded-2xl border border-border p-5">
                  <div className="h-32 w-full rounded-xl bg-surface-raised mb-4" />
                  <div className="h-3 w-20 rounded bg-surface-raised mb-3" />
                  <div className="h-4 w-3/4 rounded bg-surface-raised" />
                  <div className="mt-2 space-y-1.5">
                    <div className="h-3 w-full rounded bg-surface-raised" />
                    <div className="h-3 w-4/5 rounded bg-surface-raised" />
                  </div>
                </div>
              ))}
            </div>
          </li>
        </ul>
      </div>

      {/* ── Discover sidebar ── */}
      <aside className="hidden lg:block w-72 shrink-0 p-4">
        <div className="h-5 w-24 rounded bg-surface-raised" />
      </aside>
    </div>
  );
}
