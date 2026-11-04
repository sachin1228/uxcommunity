import Link from "next/link";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { DashboardRouteSkeleton } from "./DashboardRouteSkeleton";

export function SidebarSkeleton() {
  return (
    <aside className="h-full w-[17rem] border-r border-border bg-background p-4" aria-label="Workspace navigation">
      <nav className="flex flex-col gap-2">
        {[["Feed", "/dashboard"], ["Explore Communities", "/dashboard/communities"], ["Library", "/dashboard/library"], ["Jobs", "/dashboard/jobs"], ["Saved", "/dashboard/saved"]].map(([label, href]) => (
          <Link key={href} href={href} prefetch={false} className="rounded-md px-3 py-2 font-body text-sm text-foreground-muted hover:bg-surface-raised">{label}</Link>
        ))}
      </nav>
      <div aria-hidden className="mt-8 space-y-4 animate-pulse">
        {[0, 1, 2].map(i => <div key={i} className="h-10 rounded-md bg-surface-raised" />)}
      </div>
    </aside>
  );
}

/** Contains no member data and may stream before registry validation finishes. */
export function DashboardSkeleton() {
  return (
    <div className="fixed inset-0 z-[10000] flex flex-col bg-background text-foreground" role="status" aria-label="Loading dashboard">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4"><BrandLogo iconClassName="h-6 w-6" wordmarkClassName="text-sm" /></header>
      <div className="flex min-h-0 flex-1">
        <div className="hidden min-[500px]:block"><SidebarSkeleton /></div>
        <div className="min-w-0 flex-1 overflow-hidden"><DashboardRouteSkeleton /></div>
      </div>
    </div>
  );
}
