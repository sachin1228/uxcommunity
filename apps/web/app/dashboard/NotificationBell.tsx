"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Bookmark,
  CalendarDays,
  CheckCheck,
  FileText,
  MessageCircle,
  Users,
} from "lucide-react";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { Spinner } from "@/components/ui/Spinner";
import { createBrowserClient } from "@/lib/supabase/browser";

type NotificationType =
  | "community_thread"
  | "community_resource"
  | "community_event"
  | "thread_comment"
  | "thread_reply"
  | "thread_vote"
  | "thread_save"
  | "resource_comment"
  | "resource_reply"
  | "resource_save"
  | "resource_bookmark"
  | "event_comment"
  | "event_reply"
  | "event_rsvp"
  | "event_save";

interface NotificationItem {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string;
  read_at: string | null;
  created_at: string;
}

interface Props {
  userId: string;
}

const MAX_ITEMS = 30;

function iconFor(type: NotificationType) {
  if (type.includes("event")) return CalendarDays;
  if (type.includes("resource")) return FileText;
  if (type.includes("save") || type.includes("bookmark")) return Bookmark;
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

export function NotificationBell({ userId }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const hasUnread = unreadCount > 0;
  const visibleCount = unreadCount > 99 ? "99+" : String(unreadCount);

  const fetchNotifications = useCallback(async () => {
    const res = await fetch("/api/notifications", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load notifications.");
    const data = await res.json();
    setNotifications((data.notifications ?? []) as NotificationItem[]);
    setUnreadCount(data.unread_count ?? 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchNotifications()
        .catch((error) => console.error("[notifications] fetch failed", error))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fetchNotifications]);

  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const next = payload.new as NotificationItem;
            setNotifications((prev) => [next, ...prev.filter((item) => item.id !== next.id)].slice(0, MAX_ITEMS));
            if (!next.read_at) setUnreadCount((count) => count + 1);
            return;
          }

          if (payload.eventType === "UPDATE") {
            const next = payload.new as NotificationItem;
            const previous = payload.old as Partial<NotificationItem>;
            setNotifications((prev) => prev.map((item) => (item.id === next.id ? next : item)));
            if (!previous.read_at && next.read_at) {
              setUnreadCount((count) => Math.max(0, count - 1));
            }
          }

          if (payload.eventType === "DELETE") {
            const previous = payload.old as NotificationItem;
            setNotifications((prev) => prev.filter((item) => item.id !== previous.id));
            if (!previous.read_at) setUnreadCount((count) => Math.max(0, count - 1));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  async function markOneRead(id: string) {
    setNotifications((prev) =>
      prev.map((item) => (item.id === id ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item)),
    );
    setUnreadCount((count) => Math.max(0, count - 1));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch((error) => console.error("[notifications] mark read failed", error));
  }

  async function markAllRead() {
    if (!hasUnread) return;
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((item) => ({ ...item, read_at: item.read_at ?? now })));
    setUnreadCount(0);
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch((error) => console.error("[notifications] mark all read failed", error));
  }

  const emptyState = useMemo(
    () => (
      <div className="px-5 py-10 text-center">
        <Bell size={22} className="mx-auto mb-2 text-foreground-muted opacity-50" />
        <p className="font-body text-sm font-medium text-foreground">No notifications yet</p>
        <p className="mt-1 font-body text-xs text-foreground-muted">
          Threads, resources, events, and replies will appear here.
        </p>
      </div>
    ),
    [],
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={hasUnread ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative h-8 w-8 flex items-center justify-center rounded-lg text-foreground-muted hover:text-foreground hover:bg-surface-raised transition-colors"
      >
        <Bell size={16} strokeWidth={1.8} />
        {hasUnread && (
          <span className="absolute -right-1 -top-1 min-w-4 h-4 rounded-full bg-red-500 px-1 text-[9px] font-semibold leading-4 text-white">
            {visibleCount}
          </span>
        )}
      </button>

      <DropdownMenu
        triggerRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="w-[360px] max-w-[calc(100vw-1rem)]"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="font-display text-sm font-semibold text-foreground">Notifications</p>
            <p className="font-body text-[11px] text-foreground-muted">
              {hasUnread ? `${unreadCount} unread` : "All caught up"}
            </p>
          </div>
          <button
            type="button"
            onClick={markAllRead}
            disabled={!hasUnread}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-body text-[11px] text-foreground-muted hover:bg-white/[0.08] hover:text-foreground disabled:opacity-40"
          >
            <CheckCheck size={13} />
            Mark read
          </button>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="h-4 w-4 text-foreground-muted" />
            </div>
          ) : notifications.length === 0 ? (
            emptyState
          ) : (
            <ul className="py-1">
              {notifications.map((item) => {
                const Icon = iconFor(item.type);
                const unread = !item.read_at;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={() => {
                        setOpen(false);
                        if (unread) void markOneRead(item.id);
                      }}
                      className="flex gap-3 px-4 py-3 transition-colors hover:bg-white/[0.06]"
                    >
                      <span
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          unread ? "bg-accent-soft text-accent" : "bg-background-subtle text-foreground-muted"
                        }`}
                      >
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <span className="line-clamp-2 flex-1 font-body text-sm font-medium leading-5 text-foreground">
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
                      {unread && <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DropdownMenu>
    </div>
  );
}
