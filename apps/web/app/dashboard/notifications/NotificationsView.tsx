"use client";

// Full-page notifications list — opened from the "Notifications" item in the
// left sidebar. Replaces the old topbar bell dropdown; the realtime sync,
// unread badge, and mark-read behaviour live in useNotifications.

import Link from "next/link";
import { useMemo } from "react";
import {
  AtSign,
  Bell,
  CalendarDays,
  CheckCheck,
  FileText,
  MessageCircle,
  Users,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import {
  useNotifications,
  type NotificationItem,
  type NotificationType,
} from "@/lib/use-notifications";

function iconFor(type: NotificationType) {
  if (type === "chat_mention") return AtSign;
  if (type.includes("event")) return CalendarDays;
  if (type.includes("resource")) return FileText;
  if (type.includes("comment") || type.includes("reply")) return MessageCircle;
  return Users;
}

function formatRelativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  return `${Math.floor(diff / day)}d`;
}

export function NotificationsView({ userId }: { userId: string }) {
  const { notifications, unreadCount, loading, markOneRead, markAllRead } =
    useNotifications(userId);

  const hasUnread = unreadCount > 0;

  const emptyState = useMemo(
    () => (
      <div className="px-5 py-16 text-center">
        <Bell strokeWidth={2.5} size={26} className="mx-auto mb-3 text-foreground-muted opacity-50" />
        <p className="font-body text-sm font-medium text-foreground">No notifications yet</p>
        <p className="mt-1 font-body text-xs text-foreground-muted">
          Threads, resources, events, replies, and @mentions will appear here.
        </p>
      </div>
    ),
    [],
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 lg:px-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-foreground">Notifications</h1>
          <p className="mt-0.5 font-body text-xs text-foreground-muted">
            {hasUnread ? `${unreadCount} unread` : "All caught up"}
          </p>
        </div>
        <button
          type="button"
          onClick={markAllRead}
          disabled={!hasUnread}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-body text-xs text-foreground-muted transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:opacity-40"
        >
          <CheckCheck strokeWidth={2.5} size={14} />
          Mark all read
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner className="h-4 w-4" />
          </div>
        ) : notifications.length === 0 ? (
          emptyState
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((item: NotificationItem) => {
              const Icon = iconFor(item.type);
              const unread = !item.read_at;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    onClick={() => {
                      if (unread) void markOneRead(item.id);
                    }}
                    className={`flex gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.06] ${
                      unread ? "bg-accent-soft/[0.35]" : ""
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        unread ? "bg-accent-soft text-accent" : "bg-background-subtle text-foreground-muted"
                      }`}
                    >
                      <Icon size={16} strokeWidth={2.5} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className="flex-1 font-body text-sm font-medium leading-5 text-foreground">
                          {item.title}
                        </span>
                        <span className="shrink-0 font-body text-[11px] text-foreground-subtle">
                          {formatRelativeTime(item.created_at)}
                        </span>
                      </span>
                      {item.body && (
                        <span className="mt-0.5 line-clamp-2 block font-body text-xs leading-5 text-foreground-muted">
                          {item.body}
                        </span>
                      )}
                    </span>
                    {unread && <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
