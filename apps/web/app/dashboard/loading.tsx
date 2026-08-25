import { BookOpen, CalendarDays, Palette, Plus, User } from "lucide-react";
import { communityFeedLayout } from "@/components/communities/feed-layout";
import { Spinner } from "@/components/ui/Spinner";

/**
 * Dashboard home loading boundary.
 *
 * Mirrors the centered home page layout so navigation never looks broken: the
 * composer remains visible while the feed area shows a centered spinner. The
 * topbar and left sidebar live in the dashboard layout and remain mounted.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto min-h-full w-full max-w-6xl">
      <section className={`${communityFeedLayout.gutters} my-1`}>
        <div className="grid grid-cols-[auto_1fr] items-center gap-5 py-3 sm:py-4">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-border">
            <User size={18} className="text-foreground-muted" />
          </div>
          <div className="grid min-w-0 grid-cols-4 justify-items-center gap-1.5">
            {[
              { label: "Create Showcase", icon: Palette, color: "text-violet-600 dark:text-violet-400" },
              { label: "Create Thread", icon: Plus, color: "text-accent" },
              { label: "Create Resource", icon: BookOpen, color: "text-emerald-600 dark:text-emerald-400" },
              { label: "Create Event", icon: CalendarDays, color: "text-orange-600 dark:text-orange-400" },
            ].map(({ label, icon: Icon, color }) => (
              <div
                key={label}
                className="flex w-fit min-w-0 items-center justify-self-center gap-1 rounded-lg px-2 py-2 font-body text-[13px] font-medium text-foreground-muted"
              >
                <Icon size={16} className={color} />
                <span className="truncate">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size={28} />
      </div>
    </div>
  );
}
