/**
 * Message ordering + merging for the DM thread.
 *
 * One comparator is the contract for FOUR writers — the initial page fetch,
 * the catch-up loop, realtime merges and optimistic sends — so a thread can
 * never hold two orders of the same rows. Ordering is (created_at, id): the
 * server pages with that exact total order, and the id tiebreak is what keeps
 * same-millisecond bursts stable client-side.
 */

import type { DmMessage } from "./types";

/** Ascending (oldest first), tiebroken by id — matches the SQL page order. */
export function compareDmMessages(a: DmMessage, b: DmMessage): number {
  const byTime = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The message ordering cursor: the exact (created_at, id) pair the server pages on. */
export interface MessageCursor {
  ts: string;
  id: string;
}

/** Cursor for "everything strictly after this message". */
export function cursorAfter(message: DmMessage): MessageCursor {
  return { ts: message.created_at, id: message.id };
}

/** The newest real (non-optimistic) message, or null. */
export function newestRealMessage(messages: DmMessage[]): DmMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!messages[i].id.startsWith("temp-")) return messages[i];
  }
  return null;
}

/** The oldest real (non-optimistic) message, or null. */
export function oldestRealMessage(messages: DmMessage[]): DmMessage | null {
  for (const message of messages) {
    if (!message.id.startsWith("temp-")) return message;
  }
  return null;
}

/**
 * Merge fetched rows into the thread state.
 *
 * - Rows already present (by id) keep their CURRENT copy: it may carry
 *   client-resolved extras (reply previews, reaction state) the page row does
 *   not repeat, and realtime/optimistic layers have already refined it.
 * - Optimistic (temp-) rows are always preserved — a catch-up fetch racing an
 *   in-flight send must not delete the bubble the user is watching.
 * - A real row with a temp row's id is impossible (temp ids are prefixed),
 *   so unmounting a temp only ever happens through the send/realtime paths
 *   that know which bubble they are replacing.
 */
export function mergeDmMessages(current: DmMessage[], incoming: DmMessage[]): DmMessage[] {
  if (incoming.length === 0) return current;
  const known = new Set(current.map((m) => m.id));
  const fresh = incoming.filter((m) => !known.has(m.id));
  if (fresh.length === 0) return current;
  return [...current, ...fresh].sort(compareDmMessages);
}
