"use client";

import { useEffect } from "react";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";

/**
 * Desktop browser notifications for every in-app notification row.
 *
 * The bell only refreshes while its tab is visible — exactly when a desktop
 * notification is not needed. This hook keeps its own subscription to the
 * notifications room for as long as the dashboard is mounted (the same way
 * the sidebar's chat rooms stay connected in a background tab) and raises the
 * OS notification only when the page is hidden or another window has focus.
 *
 * Rows cover the whole bell: likes, comments and replies, event activity,
 * job matches, accepted join requests, report outcomes and removals. Chat
 * messages and DMs are not notification rows and have their own browser
 * notifications (see lib/communities/message-notifications).
 *
 * The permission is the one the sidebar's notification prompt already asks
 * for; there is nothing new to grant here.
 */

interface InAppNotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string;
  read_at: string | null;
  created_at: string;
}

/** The rule, isolated so it is testable without a DOM. */
export function shouldShowInAppBrowserNotification(
  permission: NotificationPermission | "unsupported",
  attentionAway: boolean,
): boolean {
  return permission === "granted" && attentionAway;
}

/**
 * One key per distinct notification state. An aggregated row bumps its
 * `created_at` and swaps its title, so a new event is a new key and the same
 * row read on another device is not.
 */
export function inAppBrowserNotificationKey(
  row: Pick<InAppNotificationRow, "id" | "title" | "created_at">,
): string {
  return `${row.id}|${row.title}|${row.created_at}`;
}

function attentionAway(): boolean {
  return document.visibilityState === "hidden" || !document.hasFocus();
}

function show(row: Partial<InAppNotificationRow> | null | undefined, seen: Set<string>): void {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.type !== "string" ||
    row.read_at ||
    typeof row.title !== "string"
  ) {
    return;
  }

  const key = inAppBrowserNotificationKey(row as InAppNotificationRow);
  if (seen.has(key)) return;
  seen.add(key);
  if (seen.size > 200) {
    const oldest = seen.values().next().value;
    if (oldest) seen.delete(oldest);
  }

  const permission =
    typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  if (!shouldShowInAppBrowserNotification(permission, attentionAway())) return;

  try {
    const notification = new Notification(row.title, {
      body: row.body ?? "",
      tag: `in-app-notification-${row.id}`,
    });
    notification.onclick = () => {
      window.focus();
      if (row.href) {
        // A native Notification callback runs outside React, so a full navigation is intentional.
        window.location.assign(row.href);
      }
      notification.close();
    };
  } catch {
    // Native notifications are best-effort and must never interrupt the app.
  }
}

export function useInAppBrowserNotifications(userId: string | null | undefined): void {
  useEffect(() => {
    if (!userId) return;

    // Identity before subscribe: the user-scoped room would otherwise open
    // under the client's global placeholder (see use-notifications).
    realtimeClient.init({ id: userId, name: null, avatar: null });
    const room = realtimeRooms.notifications(userId);
    const seen = new Set<string>();
    const unsubRoom = realtimeClient.subscribe(room);

    const offInsert = realtimeClient.on(room, "insert", (data) => {
      show(data as Partial<InAppNotificationRow>, seen);
    });
    const offUpdate = realtimeClient.on(room, "update", (data) => {
      const payload = data as { next?: Partial<InAppNotificationRow> };
      show(payload.next, seen);
    });

    realtimeClient.connect();

    return () => {
      offInsert();
      offUpdate();
      unsubRoom();
    };
  }, [userId]);
}
