/**
 * Shown immediately when navigating to /dashboard while the server component
 * resolves its session + DB fetch. Matches the welcome page layout exactly.
 */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-56 rounded bg-surface-raised mb-2" />
      <div className="h-4 w-96 rounded bg-surface-raised" />
    </div>
  );
}
