/**
 * Starts the DM thread's first page when a notification arrives or is tapped,
 * so the request overlaps navigation instead of following it. The thread takes
 * the same promise — one request, not two.
 */

import { getDmMessages, type DmMessagePage } from './dmApi';
import { rememberDmMessages } from './dmMessageStore';
import { readDmPushSnapshot } from './dmPushSnapshot';

const PREFETCH_TTL_MS = 20_000;
const MAX_PREFETCHES = 6;

interface PrefetchEntry {
  promise: Promise<DmMessagePage>;
  startedAt: number;
}

const entries = new Map<string, PrefetchEntry>();

const keyFor = (userId: string, conversationId: string) => `${userId}:${conversationId}`;

function evict(): void {
  while (entries.size > MAX_PREFETCHES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function prefetchDmMessages(
  userId: string | null | undefined,
  conversationId: string | null | undefined,
): void {
  if (!userId || !conversationId) return;
  const key = keyFor(userId, conversationId);
  const existing = entries.get(key);
  if (existing && Date.now() - existing.startedAt < PREFETCH_TTL_MS) return;

  const entry: PrefetchEntry = {
    promise: getDmMessages(conversationId),
    startedAt: Date.now(),
  };
  entries.delete(key);
  entries.set(key, entry);
  evict();
  void entry.promise
    .then((page) => rememberDmMessages(userId, conversationId, page.messages))
    .catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
}

/**
 * The prefetched page when the screen opens right after a tap; otherwise a
 * normal request. A page older than the TTL is discarded rather than painted
 * as if it were current.
 */
export function takePrefetchedDmMessages(
  userId: string,
  conversationId: string,
): Promise<DmMessagePage> {
  const key = keyFor(userId, conversationId);
  const entry = entries.get(key);
  if (entry) {
    entries.delete(key);
    if (Date.now() - entry.startedAt < PREFETCH_TTL_MS) return entry.promise;
  }
  return getDmMessages(conversationId);
}

/** Seed the memory window from a push's complete message row. */
export function cacheDmPushSnapshot(
  userId: string | null | undefined,
  data: Record<string, unknown>,
): boolean {
  if (!userId) return false;
  const message = readDmPushSnapshot(userId, data);
  if (!message) return false;
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId : null;
  rememberDmMessages(userId, conversationId, [message]);
  return true;
}
