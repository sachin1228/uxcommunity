import Link from "next/link";
import { Bookmark, Briefcase, Compass, LayoutGrid, Library, Plus, Search } from "lucide-react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { DmIcon } from "@/components/ui/DmIcon";
import { NotificationBellIcon } from "@/components/ui/NotificationBellIcon";
import { DashboardRouteSkeleton } from "./DashboardRouteSkeleton";

/**
 * Mirror of GlobalSidebar's static chrome — same section labels, nav icons and
 * row geometry — so the takeover hands off to the real sidebar without the
 * frame jumping. Only the community list, which is member data, renders as
 * pulsing rows.
 */
export function SidebarSkeleton() {
  const navItems = [
    { label: "Feed", href: "/dashboard", icon: LayoutGrid },
    { label: "Explore Communities", href: "/dashboard/communities", icon: Compass },
    { label: "Library", href: "/dashboard/library", icon: Library },
    { label: "Jobs", href: "/dashboard/jobs", icon: Briefcase },
    { label: "Saved", href: "/dashboard/saved", icon: Bookmark },
  ];
  // Name / members / preview widths, varied so the list reads like rows of
  // different communities rather than one repeated block.
  const rowWidths = [
    ["w-28", "w-14", "w-36"],
    ["w-20", "w-16", "w-32"],
    ["w-24", "w-12", "w-36"],
    ["w-28", "w-16", "w-28"],
  ];

  return (
    <aside
      className="flex h-full w-[17rem] shrink-0 flex-col overflow-hidden border-r border-border bg-background"
      aria-label="Workspace navigation"
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="px-[8px] pb-[9px] pt-[13px]">
          <p className="mb-[9px] px-[14px] font-body text-[9px] font-semibold uppercase tracking-widest text-foreground-muted">
            Workspace
          </p>
          <nav>
            <ul className="flex flex-col gap-[3px]">
              {navItems.map(({ label, href, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    prefetch={false}
                    className="flex items-center gap-[11px] rounded-lg px-[13px] py-[7px] font-body text-sm font-normal text-foreground-muted"
                  >
                    <Icon strokeWidth={2.5} size={15} className="shrink-0" />
                    <span className="flex-1 truncate">{label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div aria-hidden="true" className="motion-safe:animate-pulse">
          <div className="flex items-center justify-between px-[22px] pb-[7px] pt-[9px]">
            <span className="font-body text-[9px] font-semibold uppercase tracking-widest text-foreground-muted">
              Your Community
            </span>
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-surface-raised">
              <Plus size={11} strokeWidth={2.5} className="text-foreground-muted" />
            </span>
          </div>
          <ul className="flex flex-col gap-[3px] px-[8px]">
            {rowWidths.map(([name, members, preview], i) => (
              <li key={i} className="flex w-full items-start gap-[11px] rounded-lg px-[14px] py-[9px]">
                <div className="h-9 w-9 shrink-0 rounded-full bg-surface-raised" />
                <div className="mt-[3px] min-w-0 flex-1">
                  <div className={`mb-[6px] h-[14px] ${name} rounded bg-surface-raised`} />
                  <div className={`mb-[9px] h-[11px] ${members} rounded bg-surface-raised`} />
                  <div className={`h-[13px] ${preview} rounded bg-surface-raised`} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}

/**
 * Mirror of Topbar's static chrome: brand zone, the search pill and the
 * account cluster. Only the avatar — member data — pulses.
 */
function TopbarSkeleton() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background pr-3 sm:pr-4">
      <div className="order-1 flex min-w-0 items-center gap-2 pl-3 sm:pl-4 min-[500px]:w-[17rem] min-[500px]:shrink-0">
        <BrandLogo iconClassName="h-6 w-6" wordmarkClassName="text-sm" />
      </div>
      <div
        aria-hidden="true"
        className="order-3 flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-full border border-border text-foreground-muted min-[500px]:order-2 sm:min-w-0 sm:flex-1 sm:max-w-[40rem] sm:justify-start sm:px-4"
      >
        <Search size={14} strokeWidth={2.5} className="shrink-0" />
        <span className="hidden min-w-0 flex-1 truncate text-left font-body text-xs sm:block">Search</span>
        <kbd className="hidden rounded border border-border px-1 py-0.5 font-mono text-[10px] leading-none sm:block">⌘K</kbd>
      </div>
      <div aria-hidden="true" className="order-4 ml-auto flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center text-foreground-muted">
          <DmIcon size={18} />
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="9" r="7" fill="none" strokeWidth="2" stroke="currentColor" className="text-overlay-elevated" />
          </svg>
        </span>
        <span className="flex h-8 w-8 items-center justify-center text-foreground-muted">
          <NotificationBellIcon size={18} />
        </span>
        <span className="h-8 w-8 shrink-0 rounded-full bg-surface-raised motion-safe:animate-pulse" />
      </div>
    </header>
  );
}

/** Contains no member data and may stream before registry validation finishes. */
export function DashboardSkeleton() {
  return (
    <div className="fixed inset-0 z-[10000] flex flex-col bg-background text-foreground" role="status" aria-label="Loading dashboard">
      <TopbarSkeleton />
      <div className="flex min-h-0 flex-1">
        <div className="hidden min-[500px]:block"><SidebarSkeleton /></div>
        <div className="min-w-0 flex-1 overflow-hidden"><DashboardRouteSkeleton /></div>
      </div>
    </div>
  );
}
