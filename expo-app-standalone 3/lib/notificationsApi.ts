/**
 * Notifications REST calls — the same endpoints the web client uses
 * (`GET/PATCH /api/notifications`), reached through the session-cookie client.
 */

import { apiFetch } from './api';
import type { NotificationItem } from './notifications';

export interface NotificationsPage {
  notifications: NotificationItem[];
  /** Server truth: rows with read_at null (may exceed the loaded page). */
  unreadCount: number;
}

/**
 * Last fetched page, shared by every hook instance. The header bell mounts
 * once per tab screen, so without this a member switching between the four
 * tabs would refetch the same page four times; a fresh page seeds a late
 * instance instead.
 */
let cachedPage: { page: NotificationsPage; userId: string; at: number } | null = null;

const PAGE_FRESH_MS = 30_000;

export function peekNotificationsPage(userId: string): NotificationsPage | null {
  if (!cachedPage) return null;
  if (cachedPage.userId !== userId) return null;
  if (Date.now() - cachedPage.at > PAGE_FRESH_MS) return null;
  return cachedPage.page;
}

/** Drops the shared page (account switch); the next fetch starts clean. */
export function forgetNotificationsPage(): void {
  cachedPage = null;
}

/**
 * Applies an optimistic mutation to the shared page so an instance mounting
 * within the freshness window cannot seed from a stale copy (web equivalent:
 * patchCachedRequest).
 */
export function patchNotificationsPage(
  userId: string,
  update: (page: NotificationsPage) => NotificationsPage,
): void {
  if (!cachedPage || cachedPage.userId !== userId) return;
  cachedPage = { ...cachedPage, page: update(cachedPage.page) };
}

export async function getNotifications(userId?: string): Promise<NotificationsPage> {
  const { data } = await apiFetch<{
    notifications?: NotificationItem[];
    unread_count?: number;
  }>('/api/notifications');

  const page: NotificationsPage = {
    notifications: data?.notifications ?? [],
    unreadCount: data?.unread_count ?? 0,
  };
  if (userId) cachedPage = { page, userId, at: Date.now() };
  return page;
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiFetch('/api/notifications', { method: 'PATCH', body: { id } });
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiFetch('/api/notifications', { method: 'PATCH', body: { all: true } });
}
