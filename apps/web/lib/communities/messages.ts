/**
 * Message ordering, merging and catch-up draining for the community chat.
 *
 * WHY THIS EXISTS
 *   Four writers touch the message array — the first page fetch, the
 *   upward-pagination fetch, the catch-up drain and realtime — and three
 *   different questions were answered inline in useChatData.ts, twice with a
 *   subtly different rule. That produced two defects:
 *
 *     1. the full-page fetch REPLACED the array (`setMessages(page)`), so any
 *        message realtime delivered while that request was in flight was thrown
 *        away, together with the optimistic bubble of a send in progress;
 *     2. the incremental merges dropped every `temp-` (optimistic) row they
 *        found, so a catch-up landing mid-send made the bubble the user was
 *        watching disappear.
 *
 *   One rule now applies to all of them, and it is the DM chat's rule
 *   (lib/direct-messages/messages.ts):
 *
 *     A row we already hold WINS. The fetched row is only used to bring in ids
 *     we do not have. Rows realtime delivered during the request therefore
 *     survive, optimistic rows are never removed, and the result is always
 *     ordered by the same total order the server pages on.
 *
 *   "Existing wins" is deliberate rather than merely convenient: the page row
 *   is a snapshot taken before the request returned, so letting it overwrite
 *   would revert a reaction, an edit or a removal that arrived while it was in
 *   flight. The fetch's job on this path is to seed what is missing, and missed
 *   mutations are healed by realtime, or by a reload (which drops these
 *   module-level caches) — never by re-reading an old row.
 *
 * ORDERING
 *   `(created_at, id)` — the exact total order `get_community_message_page`
 *   pages on. Sorting on the timestamp alone left equal-timestamp rows in
 *   arrival order, which is what let a page boundary land inside a burst. The
 *   id tiebreak is also what makes the cursor comparable: `temp-` ids sort
 *   after real uuids at the same timestamp, so an optimistic bubble stays at
 *   the bottom of the burst it was sent into until its echo replaces it.
 */

import type { MessageCursor } from "./message-cursor";

export type { MessageCursor };

/** The minimum a row must expose to be ordered, merged and cursored. */
export interface CursorMessage {
  id: string;
  created_at: string;
}

/** Optimistic rows are prefixed; they exist only until their echo arrives. */
const TEMP_ID_PREFIX = "temp-";

export function isOptimistic(message: { id: string }): boolean {
  return message.id.startsWith(TEMP_ID_PREFIX);
}

/** The total order the server pages on: ascending (created_at, id). */
export function compareCommunityMessages(a: CursorMessage, b: CursorMessage): number {
  const byTime = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The cursor naming this row's position — both halves, always. */
export function cursorOf(message: CursorMessage): MessageCursor {
  return { ts: message.created_at, id: message.id };
}

/**
 * The newest real row's cursor, or null when the array holds no real row yet.
 * Used to start a catch-up from exactly where the client stopped.
 */
export function newestRealCursor(messages: CursorMessage[]): MessageCursor | null {
  let newest: CursorMessage | null = null;
  for (const message of messages) {
    if (isOptimistic(message)) continue;
    if (!newest || compareCommunityMessages(message, newest) > 0) newest = message;
  }
  return newest ? cursorOf(newest) : null;
}

/**
 * The oldest real row's cursor, or null — the `before` cursor for pagination.
 */
export function oldestRealCursor(messages: CursorMessage[]): MessageCursor | null {
  let oldest: CursorMessage | null = null;
  for (const message of messages) {
    if (isOptimistic(message)) continue;
    if (!oldest || compareCommunityMessages(message, oldest) < 0) oldest = message;
  }
  return oldest ? cursorOf(oldest) : null;
}

/**
 * Merge a fetched page into what is already on screen.
 *
 * - a row we already hold keeps its CURRENT copy (see the module doc: realtime
 *   and client-resolved fields are newer than the fetched snapshot);
 * - rows we do not hold are added;
 * - optimistic rows are always preserved — only the send/echo paths replace one;
 * - the result is sorted by compareCommunityMessages.
 *
 * Returns the SAME array when the page added nothing, so callers can bail out
 * of a re-render. Duplicates inside `incoming` are collapsed too, which makes the
 * merge idempotent — merging the same page twice is a no-op, and a boundary
 * re-read cannot double a row even if one array ever carried it twice.
 */
export function mergeCommunityMessages<T extends CursorMessage>(
  current: T[],
  incoming: T[],
): T[] {
  if (incoming.length === 0) return current;
  const known = new Set(current.map((message) => message.id));
  const fresh: T[] = [];
  for (const message of incoming) {
    // Already on screen — keep the copy we hold (see the module doc) — or
    // already taken from this same page.
    if (known.has(message.id)) continue;
    known.add(message.id);
    fresh.push(message);
  }
  if (fresh.length === 0) return current;
  return [...current, ...fresh].sort(compareCommunityMessages);
}

/** What may be written to the cache: optimistic rows never are. */
export function persistableMessages<T extends CursorMessage>(messages: T[]): T[] {
  return messages.filter((message) => !isOptimistic(message));
}

/** How a drain ended — every stop reason is a normal outcome. */
export type CatchUpStop =
  | "complete"
  | "empty"
  | "repeated-cursor"
  | "max-pages"
  | "cancelled"
  | "error";

export interface CatchUpResult {
  /** Pages fetched (including an empty confirming page). */
  pages: number;
  /** Rows handed to `onPage`, across all pages. */
  applied: number;
  stoppedBy: CatchUpStop;
  /** Set only when `stoppedBy` is "error" — the drain never throws. */
  error?: unknown;
}

export interface CatchUpOptions<T extends CursorMessage> {
  /**
   * Where the client stopped: the newest message it already holds. `null` (or
   * omitted) means it holds nothing, so the newest page IS the catch-up.
   */
  from?: MessageCursor | null;
  /** Server page size. A shorter page means the history is drained. */
  pageSize: number;
  /** Hard cap on pages fetched in ONE pass. */
  maxPages: number;
  /** Fetch one page strictly after `after`; null fetches the newest page. */
  fetchPage: (after: MessageCursor | null) => Promise<T[]>;
  /** Called per non-empty page, in arrival order. */
  onPage?: (page: T[], after: MessageCursor | null) => void;
  /** True once the caller has been superseded (community switched, unmount). */
  isCancelled?: () => boolean;
}

/**
 * Drain every message newer than `from`, one page at a time.
 *
 * Bounds and guards, because a catch-up runs on every (re)subscribe, reconnect
 * and tab return and must never be able to loop:
 *
 *   * `maxPages` caps one pass, so a pathological server cannot spin;
 *   * a page shorter than `pageSize` ends the pass — that is the "history is
 *     drained" signal;
 *   * an EMPTY page ends it too (nothing newer remains);
 *   * a cursor that does not advance, or one already used this pass, ends it —
 *     a page that keeps returning itself would otherwise re-fetch forever;
 *   * a throw from `fetchPage` ends the pass and is REPORTED, not rethrown:
 *     callers are fire-and-forget, and the next trigger retries;
 *   * `isCancelled` is checked before every fetch and before every apply, so a
 *     community switch cannot paint a page into the wrong chat;
 *   * `from === null` fetches the newest page and STOPS. There is nothing newer
 *     than the newest page to drain, so the extra round trip a DM-style drain
 *     would spend confirming that is skipped here. (The DM chat has to make it
 *     because its `catchUp(null)` is also its initial load.)
 */
export async function runCatchUp<T extends CursorMessage>(
  options: CatchUpOptions<T>,
): Promise<CatchUpResult> {
  const { from = null, pageSize, maxPages, fetchPage, onPage, isCancelled } = options;

  let cursor: MessageCursor | null = from;
  const usedCursors = new Set<string>();
  // The starting cursor counts as used: a server that echoes it back instead of
  // advancing must end the pass, not repeat it.
  if (from) usedCursors.add(`${from.ts}|${from.id}`);
  let pages = 0;
  let applied = 0;

  for (let index = 0; index < Math.max(1, maxPages); index += 1) {
    if (isCancelled?.()) return { pages, applied, stoppedBy: "cancelled" };

    let page: T[];
    try {
      page = await fetchPage(cursor);
    } catch (error) {
      return { pages, applied, stoppedBy: "error", error };
    }
    pages += 1;

    if (isCancelled?.()) return { pages, applied, stoppedBy: "cancelled" };
    if (page.length === 0) return { pages, applied, stoppedBy: "empty" };

    onPage?.(page, cursor);
    applied += page.length;

    // With no cursor the server answers with the newest page; there is nothing
    // newer to walk to, and a second call could only repeat it.
    if (cursor === null) return { pages, applied, stoppedBy: "complete" };

    if (page.length < pageSize) return { pages, applied, stoppedBy: "complete" };

    const next = newestPageCursor(page);
    // No real row to advance past (a page of optimistic rows only): stop rather
    // than re-fetch the same page forever.
    if (!next) return { pages, applied, stoppedBy: "complete" };

    const key = `${next.ts}|${next.id}`;
    if (key === `${cursor.ts}|${cursor.id}`) {
      return { pages, applied, stoppedBy: "repeated-cursor" };
    }
    if (usedCursors.has(key)) {
      return { pages, applied, stoppedBy: "repeated-cursor" };
    }
    usedCursors.add(key);
    cursor = next;
  }

  return { pages, applied, stoppedBy: "max-pages" };
}

/**
 * The cursor to continue from after a page, or null when the page holds no real
 * row. The `after` branch returns ascending rows, so this is its last row; taking
 * the maximum instead of the last keeps the walk correct even if a caller hands
 * over a page in another order (the newest page, for instance, is descending).
 */
function newestPageCursor<T extends CursorMessage>(page: T[]): MessageCursor | null {
  return newestRealCursor(page);
}
