/**
 * Shown immediately when navigating to /dashboard while the server component
 * resolves its session + DB fetch. Matches the welcome page layout exactly.
 */
export default function DashboardLoading() {
  return (
    <div className="px-8 py-8 animate-pulse">
      {/* "Welcome back, Name" */}
      <div className="h-8 w-64 rounded bg-surface-raised mb-2" />
      {/* subtitle */}
      <div className="h-4 w-96 rounded bg-surface-raised" />
    </div>
  );
}
