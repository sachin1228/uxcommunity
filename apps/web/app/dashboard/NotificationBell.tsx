"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationBellIcon } from "@/components/ui/NotificationBellIcon";
import { useNotifications } from "@/lib/use-notifications";

/**
 * The notifications entry point and its unread badge.
 *
 * It used to live in the sidebar's brand row, but a badge is only useful where
 * the member can always see it — the sidebar scrolls away and is closed below
 * 500px. It now belongs to the topbar, which is always on screen.
 *
 * `useNotifications` syncs every instance through the shared request cache, so
 * this badge and the notifications page stay in step.
 */
export function NotificationBell({ userId }: { userId: string }) {
  const pathname = usePathname();
  const { unreadCount } = useNotifications(userId);
  const active = pathname === "/dashboard/notifications";

  return (
    <Link
      href="/dashboard/notifications"
      aria-label={
        unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"
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
      {unreadCount > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-semibold leading-[14px] text-white"
          aria-hidden
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
