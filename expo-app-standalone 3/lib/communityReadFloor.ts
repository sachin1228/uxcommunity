/**
 * The newest activity this client had in front of it when a community chat was
 * opened, per member and community.
 *
 * Opening a chat clears its list row optimistically, but the read PATCH and
 * the list read race: a payload produced before the marker advanced still
 * reports the old counts. The floor keeps that payload from resurrecting the
 * badge; activity newer than the floor still counts.
 */

const floors = new Map<string, number>();

function floorKey(userId: string, communityId: string): string {
  return `${userId}:${communityId}`;
}

function toMs(at: string | null | undefined): number | null {
  if (!at) return null;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/** The newest activity timestamp on a list row (message or content item). */
export function communityRowActivityAt(
  row: { last_message?: { created_at: string } | null; last_content?: { created_at: string } | null } | null | undefined,
): string | null {
  const messageAt = row?.last_message?.created_at ?? null;
  const contentAt = row?.last_content?.created_at ?? null;
  const messageMs = toMs(messageAt);
  const contentMs = toMs(contentAt);
  if (messageMs === null) return contentMs === null ? null : contentAt;
  if (contentMs === null) return messageAt;
  return messageMs >= contentMs ? messageAt : contentAt;
}

/** Record that everything up to `at` was on screen when the chat opened. */
export function recordCommunityReadFloor(
  userId: string | null | undefined,
  communityId: string | null | undefined,
  at: string | null | undefined,
): void {
  const ms = toMs(at);
  if (!userId || !communityId || ms === null) return;
  const key = floorKey(userId, communityId);
  const current = floors.get(key);
  if (current !== undefined && current >= ms) return;
  floors.set(key, ms);
}

/**
 * Zero the halves of a row whose newest activity was covered by the open. The
 * message and content halves are decided separately: a message that landed
 * after the open must not hide an older content item's clearance.
 */
export function applyCommunityReadFloor<
  T extends {
    id: string;
    unread_count: number;
    unread_content_count?: number;
    last_message?: { created_at: string } | null;
    last_content?: { created_at: string } | null;
  },
>(userId: string | null | undefined, row: T): T {
  if (!userId) return row;
  const floor = floors.get(floorKey(userId, row.id));
  if (floor === undefined) return row;

  const messageMs = toMs(row.last_message?.created_at);
  const contentMs = toMs(row.last_content?.created_at);
  const messagesRead = messageMs === null || messageMs <= floor;
  const contentRead = contentMs === null || contentMs <= floor;
  const unreadCount = messagesRead ? 0 : row.unread_count;
  const contentCount = contentRead ? 0 : row.unread_content_count ?? 0;
  if (
    unreadCount === row.unread_count &&
    contentCount === (row.unread_content_count ?? 0)
  ) {
    return row;
  }
  return { ...row, unread_count: unreadCount, unread_content_count: contentCount };
}

/** Clears every floor (account switch, sign-out). */
export function resetCommunityReadFloors(): void {
  floors.clear();
}
