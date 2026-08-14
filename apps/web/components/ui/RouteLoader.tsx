import { Spinner } from "./Spinner";

/**
 * Centered page-level loading spinner used by route loading.tsx boundaries.
 * Deliberately a plain spinner — no skeletons anywhere in the app.
 */
export function RouteLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner size={28} className="text-foreground-muted" />
    </div>
  );
}
