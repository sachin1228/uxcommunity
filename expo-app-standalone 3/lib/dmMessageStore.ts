/**
 * A small in-memory DM window per conversation.
 *
 * The disk window still backs a cold launch, but the common notification tap
 * has the message in hand already (the push snapshot) and the last opened
 * thread is already decoded. Seeding from memory paints those on the first
 * frame — no spinner, no waiting for AsyncStorage.
 */

import type { DmMessage } from './dm';

const MAX_CONVERSATIONS = 6;
const MAX_MESSAGES = 80;

const windows = new Map<string, DmMessage[]>();

const keyFor = (userId: string, conversationId: string) => `${userId}:${conversationId}`;

function compareMessages(a: DmMessage, b: DmMessage): number {
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  if (at !== bt) return at - bt;
  return a.id.localeCompare(b.id);
}

/** Merge rows into the conversation's memory window (optimistic rows excluded). */
export function rememberDmMessages(
  userId: string | null | undefined,
  conversationId: string | null | undefined,
  rows: readonly DmMessage[],
): void {
  if (!userId || !conversationId || conversationId === 'new' || rows.length === 0) return;
  const key = keyFor(userId, conversationId);
  const byId = new Map((windows.get(key) ?? []).map((row) => [row.id, row]));
  let changed = false;
  for (const row of rows) {
    if (row.id.startsWith('temp-')) continue;
    byId.set(row.id, row);
    changed = true;
  }
  if (!changed) return;
  const merged = [...byId.values()].sort(compareMessages).slice(-MAX_MESSAGES);
  // Re-insert so this conversation is the most recently used before eviction.
  windows.delete(key);
  windows.set(key, merged);
  while (windows.size > MAX_CONVERSATIONS) {
    const oldest = windows.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    windows.delete(oldest);
  }
}

/** The conversation's memory window, or null when it was never seen. */
export function peekDmMessages(
  userId: string | null | undefined,
  conversationId: string | null | undefined,
): DmMessage[] | null {
  if (!userId || !conversationId) return null;
  return windows.get(keyFor(userId, conversationId)) ?? null;
}

export function clearDmMessageStore(): void {
  windows.clear();
}
