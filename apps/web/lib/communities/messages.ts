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
  /**
   * Where a later pass must resume when this one stopped with work still
   * outstanding: the last compound cursor it successfully processed (for
   * "max-pages"), or the page it was fetching when the fetch failed (for
   * "error"). Null when the history drained, or when the stop cannot be
   * continued ("cancelled", "repeated-cursor").
   *
   * `resumeFrom` is a REQUEST, not a promise: "max-pages" does not prove more
   * messages exist — the page cap may simply have been reached — so a caller
   * that continues and finds an empty page has confirmed the drain.
   */
  resumeFrom: MessageCursor | null;
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
    if (isCancelled?.()) return { pages, applied, stoppedBy: "cancelled", resumeFrom: null };

    let page: T[];
    try {
      page = await fetchPage(cursor);
    } catch (error) {
      // Resume from the cursor this fetch was issued for: pages already applied
      // stay applied (dedupe by id makes a re-read harmless), and nothing after
      // the failure is skipped.
      return { pages, applied, stoppedBy: "error", error, resumeFrom: cursor };
    }
    pages += 1;

    if (isCancelled?.()) return { pages, applied, stoppedBy: "cancelled", resumeFrom: null };
    if (page.length === 0) return { pages, applied, stoppedBy: "empty", resumeFrom: null };

    onPage?.(page, cursor);
    applied += page.length;

    // With no cursor the server answers with the newest page; there is nothing
    // newer to walk to, and a second call could only repeat it.
    if (cursor === null) return { pages, applied, stoppedBy: "complete", resumeFrom: null };

    if (page.length < pageSize) return { pages, applied, stoppedBy: "complete", resumeFrom: null };

    const next = newestPageCursor(page);
    // No real row to advance past (a page of optimistic rows only): stop rather
    // than re-fetch the same page forever.
    if (!next) return { pages, applied, stoppedBy: "complete", resumeFrom: null };

    const key = `${next.ts}|${next.id}`;
    if (key === `${cursor.ts}|${cursor.id}`) {
      return { pages, applied, stoppedBy: "repeated-cursor", resumeFrom: null };
    }
    if (usedCursors.has(key)) {
      return { pages, applied, stoppedBy: "repeated-cursor", resumeFrom: null };
    }
    usedCursors.add(key);
    cursor = next;
  }

  // The cap, not a drained history: hand the last confirmed cursor back so the
  // caller can continue from exactly where this pass stopped.
  return { pages, applied, stoppedBy: "max-pages", resumeFrom: cursor };
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

/**
 * Is a failed catch-up page worth retrying?
 *
 * The catch-up client reads `/api/communities/[id]/messages`, which answers 400
 * for a malformed cursor, 403 for a non-member and 500 for a database failure;
 * the transport itself rejects with a TypeError when the network drops. A 400 or
 * 403 can never succeed on retry — the request is permanently wrong — so only
 * transient shapes (network failures, timeouts, rate limits, 5xx) are retryable.
 * Anything unrecognised counts as transient but is still bounded by the caller's
 * retry budget, so an unknown error can never retry forever.
 */
export function isRetryableCatchUpError(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const status = (error as { status?: unknown }).status;
  if (typeof status !== "number") {
    // No HTTP status: fetchJsonCached attaches one to every response, so its
    // absence means the request never reached a response — a network drop or a
    // timeout. Both are transient.
    return true;
  }
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  if (status >= 400) return false;
  return true;
}

/**
 * Bounded, cancellable driver around {@link runCatchUp}.
 *
 * One pass cannot drain an arbitrarily long backlog (that is what `maxPages` is
 * for), so a client that was away for longer than one pass of history would keep
 * a permanent gap. This controller turns one trigger into as many passes as the
 * backlog needs — while keeping every guard the review asked for:
 *
 *   * AT MOST ONE drain runs at a time. A trigger that arrives mid-drain is
 *     remembered (newest start point wins) and drained after the current one,
 *     so concurrent triggers cannot multiply the requests;
 *   * a drain is capped at `maxPassesPerDrain` passes. If the backlog is still
 *     not drained, the remainder is handed to a DEFERRED pass scheduled from the
 *     last confirmed cursor, so a long backlog drains without a new user trigger
 *     and without one trigger starving the UI;
 *   * a deferred pass never overlaps a running drain;
 *   * a transient failure is retried a bounded `maxRetries` times, from the last
 *     confirmed cursor. A permanent failure (400/403) is not retried, and once
 *     the budget is spent the drain ends — the next reconnect, visibility change
 *     or explicit trigger retries from the newest cached cursor;
 *   * every pass's stop reason is reported through `onPass`, so a result is never
 *     silently discarded;
 *   * `dispose()` (community switch / unmount) makes `isCancelled` true, so no
 *     in-flight pass paints and no deferred pass is issued.
 */
export interface CatchUpControllerOptions<T extends CursorMessage> {
  /** Server page size. A shorter page ends a pass. */
  pageSize: number;
  /** Hard cap on pages fetched in ONE pass. */
  maxPagesPerPass: number;
  /** Hard cap on passes in one drain before the rest is deferred. */
  maxPassesPerDrain?: number;
  /** Consecutive transient-failure retries allowed inside one drain. */
  maxRetries?: number;
  /** Fetch one page strictly after `after`; null fetches the newest page. */
  fetchPage: (after: MessageCursor | null) => Promise<T[]>;
  /** Called per non-empty page, in arrival order. */
  onPage?: (page: T[], after: MessageCursor | null) => void;
  /** True once the caller has been superseded (community switched, unmount). */
  isCancelled?: () => boolean;
  /** Observability: called once per pass with its stop reason. */
  onPass?: (result: CatchUpResult) => void;
  /** Delay before a deferred continuation pass. */
  continuationDelayMs?: number;
  /** Base delay before a transient-failure retry (multiplied by attempt). */
  retryBaseDelayMs?: number;
  /** Injectable delay (tests drive it synchronously). */
  sleep?: (delayMs: number) => Promise<void>;
}

export interface CatchUpController {
  /**
   * Request a drain from `from`. Resolves when the started drain (and its
   * same-tick passes) is done; a request arriving mid-drain is queued and
   * resolves immediately.
   */
  start(from: MessageCursor | null): Promise<void>;
  /** True while a drain is executing. */
  isRunning(): boolean;
  /** Stop everything for good — community switch or unmount. */
  dispose(): void;
}

export function createCatchUpController<T extends CursorMessage>(
  options: CatchUpControllerOptions<T>,
): CatchUpController {
  const {
    pageSize,
    maxPagesPerPass,
    maxPassesPerDrain = 4,
    maxRetries = 2,
    fetchPage,
    onPage,
    isCancelled,
    onPass,
    continuationDelayMs = 750,
    retryBaseDelayMs = 1_000,
    sleep = (delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
  } = options;

  let disposed = false;
  let running = false;
  /** A start requested while a drain ran; at most one, newest start point wins. */
  let queued: MessageCursor | null | undefined;

  const cancelled = () => disposed || Boolean(isCancelled?.());

  async function drain(from: MessageCursor | null): Promise<void> {
    running = true;
    try {
      let cursor: MessageCursor | null = from;
      let passes = 0;
      let retries = 0;

      for (;;) {
        if (cancelled()) return;

        const result = await runCatchUp<T>({
          from: cursor,
          pageSize,
          maxPages: maxPagesPerPass,
          fetchPage,
          onPage,
          isCancelled: cancelled,
        });
        passes += 1;
        onPass?.(result);

        if (result.stoppedBy === "cancelled") return;

        if (result.stoppedBy === "error") {
          if (!isRetryableCatchUpError(result.error) || retries >= maxRetries) return;
          retries += 1;
          cursor = result.resumeFrom;
          await sleep(retryBaseDelayMs * retries);
          continue;
        }

        retries = 0;

        // Only a page-cap stop can leave work behind, and only with a resume
        // point. "empty"/"complete" mean the history is drained; "repeated-cursor"
        // ends the walk so a pathological server cannot loop.
        if (result.stoppedBy !== "max-pages" || !result.resumeFrom) return;
        cursor = result.resumeFrom;

        if (passes >= maxPassesPerDrain) {
          // Defer the remainder: one trigger never spins, but the backlog still
          // drains without waiting for the next user interaction.
          const target = cursor;
          void (async () => {
            await sleep(continuationDelayMs);
            if (cancelled() || running) return;
            await start(target);
          })();
          return;
        }

        // Yield between passes so a long drain cannot starve the UI.
        await sleep(0);
      }
    } catch {
      // A controller bug must never reject a fire-and-forget drain. The next
      // trigger retries from the newest cached cursor.
    } finally {
      running = false;
      flushQueued();
    }
  }

  function flushQueued(): void {
    if (disposed || running || queued === undefined) return;
    const next = queued;
    queued = undefined;
    void drain(next);
  }

  function start(from: MessageCursor | null): Promise<void> {
    if (cancelled()) return Promise.resolve();
    if (running) {
      queued = from;
      return Promise.resolve();
    }
    return drain(from);
  }

  return {
    start,
    isRunning: () => running,
    dispose: () => {
      disposed = true;
      queued = undefined;
    },
  };
}
