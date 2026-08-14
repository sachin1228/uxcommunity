import { BookOpen, CalendarDays, Plus, User } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { communityFeedLayout } from "@/components/communities/feed-layout";

/**
 * Dashboard home loading boundary.
 *
 * Mirrors the home page layout so navigation never looks broken: the composer
 * header cards and the column borders stay visible (static chrome), the feed
 * area shows a single centered spinner, and the Discover sidebar keeps its
 * own spinner. The topbar and left sidebar live in the dashboard layout and
 * remain mounted throughout navigation.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-full items-stretch">
      <div className="min-h-full min-w-0 flex-1 border-r border-border">
        {/* Header items — composer cards preserved, borders intact */}
        <section className={`${communityFeedLayout.gutters} my-1`}>
          <div className="grid grid-cols-[auto_1fr] items-center gap-2.5 py-3 sm:py-4">
            <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-border">
              <User size={18} className="text-foreground-muted" />
            </div>
            <div className="grid min-w-0 grid-cols-3 justify-items-center gap-0.5">
              {[
                { label: "Create Thread", icon: Plus, color: "text-accent" },
                { label: "Create Resource", icon: BookOpen, color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Create Event", icon: CalendarDays, color: "text-orange-600 dark:text-orange-400" },
              ].map(({ label, icon: Icon, color }) => (
                <div
                  key={label}
                  className="flex w-fit min-w-0 items-center justify-self-center gap-1 rounded-lg px-3.5 py-2.5 font-body text-sm font-medium text-foreground-muted sm:gap-1.5"
                >
                  <Icon size={20} className={color} />
                  <span className="truncate">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Feed area — single centered spinner */}
        <div className="flex min-h-[50vh] items-center justify-center">
          <Spinner size={28} className="text-foreground-muted" />
        </div>
      </div>

      {/* Discover sidebar — keeps its own spinner */}
      <aside className="sticky top-6 hidden w-72 shrink-0 p-4 lg:block">
        <h1 className="font-display text-lg font-semibold text-foreground">Discover</h1>
        <div className="flex items-center justify-center pt-28">
          <Spinner size={24} className="text-foreground-muted" />
        </div>
      </aside>
    </div>
  );
}
