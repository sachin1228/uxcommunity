import Link from "next/link";
import { BrandLogo } from "@/components/ui/BrandLogo";

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

export function FeedSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[40rem] space-y-4 px-4 pt-8" role="status" aria-label="Loading feed">
      <span className="sr-only">Loading your feed</span>
      <div aria-hidden className="animate-pulse space-y-4">
        <div className="h-8 w-40 rounded-md bg-surface-raised" />
        {[0, 1].map(i => <div key={i} className="h-56 rounded-xl border border-border bg-surface" />)}
      </div>
    </div>
  );
}

/** Contains no member data and may stream before registry validation finishes. */
export function DashboardSkeleton() {
  return (
    <div className="fixed inset-0 z-[10000] flex flex-col bg-background text-foreground" role="status" aria-label="Loading dashboard">
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4"><BrandLogo iconClassName="h-6 w-6" wordmarkClassName="text-sm" /></header>
      <div className="flex min-h-0 flex-1">
        <div className="hidden min-[500px]:block"><SidebarSkeleton /></div>
        <div className="min-w-0 flex-1"><FeedSkeleton /></div>
      </div>
    </div>
  );
}
