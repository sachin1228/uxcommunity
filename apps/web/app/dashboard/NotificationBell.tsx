"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationBellIcon } from "@/components/ui/NotificationBellIcon";
import { useNotifications } from "@/lib/use-notifications";

/**
 * The notifications entry point and its badge.
 *
 * It used to live in the sidebar's brand row, but a badge is only useful where
 * the member can always see it — the sidebar scrolls away and is closed below
 * 500px. It now belongs to the topbar, which is always on screen.
 *
 * The badge counts what is new since the member last opened the list (see
 * useNotifications): opening it clears the number without marking anything
 * read, and the next notification starts the count from one again.
 *
 * `useNotifications` syncs every instance through the shared request cache, so
 * this badge and the notifications page stay in step.
 */
export function NotificationBell({ userId }: { userId: string }) {
  const pathname = usePathname();
  const { unseenCount } = useNotifications(userId);
  const active = pathname === "/dashboard/notifications";

  return (
    <Link
      href="/dashboard/notifications"
      aria-label={
        unseenCount > 0 ? `${unseenCount} new notifications` : "Notifications"
      }
      aria-current={active ? "page" : undefined}
      title="Notifications"
      className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? "bg-surface-raised text-foreground"
          : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
      }`}
    >
      <NotificationBellIcon size={18} />
      {unseenCount > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[14px] text-white"
          aria-hidden
        >
          {unseenCount > 99 ? "99+" : unseenCount}
        </span>
      )}
    </Link>
  );
}
