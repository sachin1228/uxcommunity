"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { MobileSidebar } from "@/components/sidebar/MobileSidebar";
import { DashboardSearch } from "./DashboardSearch";
import { NotificationBell } from "./NotificationBell";
import { ProfileDropdown } from "./ProfileDropdown";
import { isApplePlatform } from "@/lib/dashboard/topbar";

/**
 * The dashboard's topbar — the app's header, spanning the full window.
 *
 * It owns what should be visible from every page and independent of the
 * sidebar's scroll position: the brand, search, the unread badge, and the
 * profile menu. The sidebar keeps navigation only.
 *
 * It also carries the narrow-viewport nav trigger, because the sidebar is
 * hidden below 500px.
 *
 * There is deliberately no page title or breadcrumb here: the pages name
 * themselves, and duplicating that above every one of them bought nothing.
 */

interface Props {
  userId: string;
  user: {
    name: string;
    email: string;
    avatarUrl: string | null;
  };
}

/** Nothing can change the platform while the tab is open, so this never fires. */
function subscribeToPlatform() {
  return () => undefined;
}

/** The client's answer, cached — `getSnapshot` runs on every render and the
 *  user agent cannot change under us. */
let cachedIsApple: boolean | null = null;
function getIsApple() {
  if (cachedIsApple === null) cachedIsApple = isApplePlatform(navigator.userAgent);
  return cachedIsApple;
}

export function Topbar({ userId, user }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);

  // The platform is read through a client-only snapshot rather than during
  // render: the server has no user agent to trust, and deciding during render
  // would hydrate the wrong key hint. The third argument is what the server
  // renders, so ⌘K is assumed until the browser corrects it — the same shape as
  // the shared Modal's mount check.
  const isApple = useSyncExternalStore(subscribeToPlatform, getIsApple, () => true);

  // One listener owns both shortcuts the bar advertises, so the palette never
  // has to know how it was opened or closed.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSearchOpen(false);
        return;
      }
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background pr-3 sm:pr-4">
      {/* Brand — moved out of the sidebar so the app's identity reads as the
          header's, and stays put while the sidebar scrolls.

          It sits in a zone exactly as wide as the sidebar (see the sidebar's
          own w-[17rem]), so everything after it starts where the content column
          does — the bar's two halves line up with the two panes below. */}
      <div className="order-1 flex min-w-0 items-center gap-2 pl-3 sm:pl-4 min-[500px]:w-[17rem] min-[500px]:shrink-0">
        <MobileSidebar userId={userId} />
        <Link
          href="/dashboard"
          className="flex min-w-0 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <BrandLogo iconClassName="h-6 w-6" wordmarkClassName="text-sm" />
        </Link>
      </div>

      {/* Search is one button in two places, moved by `order` rather than
          rendered twice. Wide, it heads the content column; narrow, it joins
          the account cluster instead — a lone icon floating in the middle of a
          phone's header reads as a mistake, and the flex spacer is what
          separates the two sides. Both layouts keep DOM order (brand, search,
          bell, avatar) equal to what is on screen, so tab order still matches. */}
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        aria-label="Search"
        aria-haspopup="dialog"
        className="order-3 flex h-8 w-8 shrink-0 items-center justify-center gap-2 rounded-lg border border-border font-body text-xs text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent min-[500px]:order-2 sm:w-80 sm:justify-start sm:px-2.5"
      >
        <Search size={14} strokeWidth={2.5} className="shrink-0" aria-hidden="true" />
        <span className="hidden flex-1 text-left sm:block">Search</span>
        <kbd className="hidden rounded border border-border px-1 py-0.5 font-mono text-[10px] leading-none sm:block">
          {isApple ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <div className="order-2 min-w-0 flex-1 min-[500px]:order-3" />

      {/* Bell, then profile: the account controls stay pinned to the right edge
          at every width. */}
      <div className="order-4 flex min-w-0 items-center gap-3">
        <NotificationBell userId={userId} />
        <ProfileDropdown name={user.name} email={user.email} avatarUrl={user.avatarUrl} />
      </div>

      {searchOpen && <DashboardSearch open onClose={() => setSearchOpen(false)} />}
    </header>
  );
}
