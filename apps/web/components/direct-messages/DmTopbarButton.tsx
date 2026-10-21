"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DmIcon } from "@/components/ui/DmIcon";
import { useDmUnreadBadge } from "./hooks/useDmUnreadBadge";

/**
 * The topbar's Messages entry point — immediately beside the notification
 * bell, same footprint and badge treatment. Opens /dashboard/messages, the
 * one surface where private DMs live.
 */
export function DmTopbarButton({ userId }: { userId: string }) {
  const pathname = usePathname();
  const unreadCount = useDmUnreadBadge(userId);
  const active = pathname === "/dashboard/messages";

  return (
    <Link
      href="/dashboard/messages"
      aria-label={unreadCount > 0 ? `${unreadCount} unread conversations` : "Messages"}
      aria-current={active ? "page" : undefined}
      title="Messages"
      className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        active
          ? "bg-surface-raised text-foreground"
          : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
      }`}
    >
      <DmIcon size={18} />
      {unreadCount > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[14px] text-white"
          aria-hidden
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
