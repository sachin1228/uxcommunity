"use client";

// Full-page notifications list — opened from the "Notifications" item in the
// left sidebar. Replaces the old topbar bell dropdown; the realtime sync,
// unread badge, and mark-read behaviour live in useNotifications.

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AtSign,
  Bell,
  CalendarDays,
  CheckCheck,
  FileText,
  Heart,
  MessageCircle,
  Users,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import {
  NOTIFICATION_TABS,
  splitNotificationsByTab,
  type NotificationTab,
} from "@/lib/notifications-tabs";
import {
  useNotifications,
  type NotificationItem,
  type NotificationType,
} from "@/lib/use-notifications";

function iconFor(type: NotificationType) {
  if (type === "chat_mention") return AtSign;
  if (type === "thread_like") return Heart;
  if (type.includes("event")) return CalendarDays;
  if (type.includes("resource")) return FileText;
  if (type.includes("comment") || type.includes("reply")) return MessageCircle;
  return Users;
}

/** Icons are a view concern; the tab keys/labels come from the shared module. */
const TAB_ICONS: Record<NotificationTab, typeof Bell> = {
  activity: MessageCircle,
  other: Bell,
};

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

function EmptyNotifications({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Bell;
  title: string;
  hint: string;
}) {
  return (
    <div className="px-5 py-16 text-center">
      <Icon strokeWidth={2.5} size={26} className="mx-auto mb-3 text-foreground-muted opacity-50" />
      <p className="font-body text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 font-body text-xs text-foreground-muted">{hint}</p>
    </div>
  );
}

export function NotificationsView({ userId }: { userId: string }) {
  const { notifications, unreadCount, loading, markOneRead, markAllRead } =
    useNotifications(userId);

  const [tab, setTab] = useState<NotificationTab>("activity");

  const hasUnread = unreadCount > 0;

  // Unread counts are derived from the loaded page — the server total
  // (`unreadCount`) is not split by type.
  const { activity, other, unreadByTab } = useMemo(
    () => splitNotificationsByTab(notifications),
    [notifications],
  );

  const visible = tab === "activity" ? activity : other;

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

      {/* Hidden while the very first page loads and when the account has no
          notifications at all — a tab bar over nothing is just noise. */}
      {!loading && notifications.length > 0 && (
        <div
          role="tablist"
          aria-label="Notification types"
          className="mt-4 flex items-center gap-1 overflow-x-auto border-b border-border md:gap-3"
        >
          {NOTIFICATION_TABS.map(({ key, label }) => {
            const Icon = TAB_ICONS[key];
            const active = tab === key;
            const unread = unreadByTab[key];
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`notifications-tab-${key}`}
                aria-selected={active}
                aria-controls="notifications-panel"
                onClick={() => setTab(key)}
                className={`border-b-2 px-3 py-2.5 font-body text-xs transition-colors ${
                  active
                    ? "border-accent text-foreground"
                    : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Icon size={14} strokeWidth={2.5} aria-hidden="true" />
                  {label}
                  {unread > 0 && (
                    <span
                      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-soft px-1 font-body text-[10px] font-semibold leading-none text-accent"
                      title={`${unread} unread`}
                    >
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div
        role="tabpanel"
        id="notifications-panel"
        aria-labelledby={`notifications-tab-${tab}`}
        className="mt-4 overflow-hidden rounded-xl border border-border bg-surface"
      >
        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner className="h-4 w-4" />
          </div>
        ) : notifications.length === 0 ? (
          <EmptyNotifications
            icon={Bell}
            title="No notifications yet"
            hint="Likes, comments, new threads, resources, events, and @mentions will appear here."
          />
        ) : visible.length === 0 ? (
          tab === "activity" ? (
            <EmptyNotifications
              icon={MessageCircle}
              title="No likes or comments yet"
              hint="Likes and comments on your threads, resources, and events will appear here."
            />
          ) : (
            <EmptyNotifications
              icon={Bell}
              title="Nothing else yet"
              hint="New threads, resources, events, RSVPs, and @mentions will appear here."
            />
          )
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((item: NotificationItem) => {
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
