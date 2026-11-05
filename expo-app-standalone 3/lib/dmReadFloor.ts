/**
 * The newest position this client has already marked read, per conversation.
 *
 * Opening a chat clears its row optimistically, but the read PATCH and the
 * list refetch race: a payload produced before the marker advanced still
 * reports the old unread count. The floor keeps that payload from
 * resurrecting the badge; messages newer than the floor still count.
 */

const floors = new Map<string, string>();

/** Record that everything up to `at` is read here (monotonic). */
export function recordDmReadFloor(conversationId: string, at: string | null | undefined): void {
  if (!conversationId || !at) return;
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) return;
  const current = floors.get(conversationId);
  if (!current || atMs > Date.parse(current)) floors.set(conversationId, at);
}

/** Zero a row whose newest message is at or before the recorded floor. */
export function applyDmReadFloor<T extends {
  id: string;
  unread_count: number;
  last_message_at: string | null;
}>(row: T): T {
  const floor = floors.get(row.id);
  if (!floor || !row.last_message_at) return row;
  if (Date.parse(row.last_message_at) > Date.parse(floor)) return row;
  return row.unread_count === 0 ? row : { ...row, unread_count: 0 };
}

export function resetDmReadFloors(): void {
  floors.clear();
}
