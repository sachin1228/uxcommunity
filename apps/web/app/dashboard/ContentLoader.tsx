import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/Spinner";

/**
 * Loading shell for dashboard pages that share the "content + Discover
 * sidebar" layout (home feed, thread/event/resource detail pages).
 *
 * Keeps the layout chrome — column borders and the Discover sidebar — visible
 * while loading, with a single centered spinner in the content area and one in
 * the sidebar. Pass `header` to preserve page-specific header items (e.g. the
 * home composer cards); detail pages pass nothing.
 */
export function DashboardContentLoader({ header }: { header?: ReactNode }) {
  return (
    <div className="flex min-h-full items-stretch">
      <div className="min-h-full min-w-0 flex-1 border-r border-border">
        {header}
        <div className="flex min-h-[50vh] items-center justify-center">
          <Spinner size={28} className="text-foreground-muted" />
        </div>
      </div>

      <aside className="sticky top-6 hidden w-72 shrink-0 p-4 lg:block">
        <h1 className="font-display text-lg font-semibold text-foreground">Discover</h1>
        <div className="flex items-center justify-center pt-28">
          <Spinner size={24} className="text-foreground-muted" />
        </div>
      </aside>
    </div>
  );
}
