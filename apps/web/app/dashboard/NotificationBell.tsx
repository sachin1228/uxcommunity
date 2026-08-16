"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CalendarDays,
  CheckCheck,
  FileText,
  MessageCircle,
  Users,
} from "lucide-react";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { Spinner } from "@/components/ui/Spinner";
import { RealtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";

type NotificationType =
  | "community_thread"
  | "community_resource"
  | "community_event"
  | "thread_comment"
  | "thread_reply"
  | "thread_like"
  | "resource_comment"
  | "resource_reply"
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
  initRequestCache(userId);
  const isVisible = useDocumentVisible();
  const cached = getCachedRequest<{ notifications?: NotificationItem[]; unread_count?: number }>("/api/notifications", userId);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(() => !cached);
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => cached?.notifications ?? []);
  const [unreadCount, setUnreadCount] = useState(() => cached?.unread_count ?? 0);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const hasUnread = unreadCount > 0;
  const visibleCount = unreadCount > 99 ? "99+" : String(unreadCount);

  const patchNotificationCache = useCallback((
    update: (current: { notifications: NotificationItem[]; unread_count: number }) => { notifications: NotificationItem[]; unread_count: number },
  ) => {
    patchCachedRequest("/api/notifications", (current: { notifications?: NotificationItem[]; unread_count?: number }) =>
      update({ notifications: current.notifications ?? [], unread_count: current.unread_count ?? 0 }), userId);
  }, [userId]);

  const fetchNotifications = useCallback(async (force = false) => {
    const data = await fetchJsonCached<{ notifications?: NotificationItem[]; unread_count?: number }>(
      "/api/notifications",
      { staleMs: 30_000, force },
      userId,
    );
    setNotifications(data.notifications ?? []);
    setUnreadCount(data.unread_count ?? 0);
  }, [userId]);

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

  // Catch up when the tab returns after a real absence — the realtime channel
  // is suspended while hidden, so notifications created during that window
  // would otherwise be missed until the next 30s refetch. Force bypasses the
  // stale window so the count is correct on return. Brief alt-tabs no longer
  // fire a request each.
  useHiddenCatchUp(() => void fetchNotifications(true).catch(() => {}));

  useEffect(() => {
    if (!isVisible) return;
    const client = new RealtimeClient({
      room: realtimeRooms.notifications(userId),
      user: { id: userId, name: null, avatar: null },
    });

    const unsubscribes: Array<() => void> = [];

    unsubscribes.push(
      client.on("insert", (data) => {
        const next = data as NotificationItem;
        setNotifications((prev) => [next, ...prev.filter((item) => item.id !== next.id)].slice(0, MAX_ITEMS));
        if (!next.read_at) setUnreadCount((count) => count + 1);
        patchNotificationCache((current) => ({
          notifications: [next, ...current.notifications.filter((item) => item.id !== next.id)].slice(0, MAX_ITEMS),
          unread_count: current.unread_count + (next.read_at ? 0 : 1),
        }));
      }),
    );

    unsubscribes.push(
      client.on("update", (data) => {
        const { next, old: previous } = data as {
          next: NotificationItem;
          old: Partial<NotificationItem>;
        };
        setNotifications((prev) => prev.map((item) => (item.id === next.id ? next : item)));
        if (!previous.read_at && next.read_at) {
          setUnreadCount((count) => Math.max(0, count - 1));
        }
        patchNotificationCache((current) => ({
          notifications: current.notifications.map((item) => item.id === next.id ? next : item),
          unread_count: !previous.read_at && next.read_at
            ? Math.max(0, current.unread_count - 1)
            : current.unread_count,
        }));
      }),
    );

    unsubscribes.push(
      client.on("delete", (data) => {
        const previous = data as NotificationItem;
        setNotifications((prev) => prev.filter((item) => item.id !== previous.id));
        if (!previous.read_at) setUnreadCount((count) => Math.max(0, count - 1));
        patchNotificationCache((current) => ({
          notifications: current.notifications.filter((item) => item.id !== previous.id),
          unread_count: previous.read_at ? current.unread_count : Math.max(0, current.unread_count - 1),
        }));
      }),
    );

    client.connect();

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      client.close();
    };
  }, [patchNotificationCache, userId, isVisible]);

  async function markOneRead(id: string) {
    setNotifications((prev) =>
      prev.map((item) => (item.id === id ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item)),
    );
    setUnreadCount((count) => Math.max(0, count - 1));
    patchNotificationCache((current) => ({
      notifications: current.notifications.map((item) => item.id === id ? { ...item, read_at: item.read_at ?? new Date().toISOString() } : item),
      unread_count: Math.max(0, current.unread_count - 1),
    }));
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
    patchNotificationCache((current) => ({
      notifications: current.notifications.map((item) => ({ ...item, read_at: item.read_at ?? now })),
      unread_count: 0,
    }));
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
