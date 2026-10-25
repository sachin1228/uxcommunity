/**
 * Realtime gap recovery — the pieces the hooks use to catch up after a socket
 * was down.
 *
 * Mobile OSes kill sockets while the app is backgrounded and network switches
 * (Wi-Fi → LTE) drop them mid-session. The client reconnects and replays its
 * subscriptions on its own, but a reconnect cannot recover what was published
 * while the socket was gone: anything sent in that window simply never arrives.
 * The hooks therefore ask the API for the gap — using the existing
 * `?after=<ISO>` message page or their existing refetch — and these helpers keep
 * that recovery cheap and deterministic:
 *
 *   createCatchUpScheduler   — collapses a burst of reconnect/foreground
 *                              triggers into one fetch, and never runs two at
 *                              the same time.
 *   latestMessageCursor      — the newest real (non-optimistic) message time,
 *                              used as the `?after=` cursor.
 *   mergeCaughtUpMessages    — merges an `?after=` page into local state without
 *                              duplicating rows and without dropping a message
 *                              the user has sent but whose echo is still in
 *                              flight.
 *
 * The row type is structural and the optimistic matcher is local, so the merge
 * rules are unit-tested without React Native (`lib/realtimeCatchUp.test.ts`).
 */

import { compareChatTimeline, type OptimisticLike } from './chat';

/** Compound cursor used by the server's canonical (created_at, id) order. */
export interface MessageCursor {
  ts: string;
  id: string;
}

/** Default settle time for a burst of reconnect triggers. */
export const CATCH_UP_DEBOUNCE_MS = 300;

export interface CatchUpScheduler {
  /** Queue a catch-up; a burst of triggers collapses into a single run. */
  schedule(): void;
  /** Run immediately (manual refresh, tests). Resolves when the run settles. */
  runNow(): Promise<void>;
  /** Drop a queued run. An in-flight fetch is left to finish on its own. */
  cancel(): void;
}

export interface CatchUpSchedulerOptions {
  debounceMs?: number;
  /** Injected so tests can drive the debounce without real timers. */
  setTimeoutFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Debounce + single-flight wrapper around a catch-up fetch.
 *
 * Three reconnects in a row (a heartbeats miss, the AppState probe fires, the
 * socket finally opens) must produce ONE request, and a trigger that lands
 * while a request is in flight must not start a second overlapping one — it
 * marks a single trailing run instead, so the trigger is honoured with the
 * freshest cursor once the first request settles.
 */
export function createCatchUpScheduler(
  run: () => void | Promise<void>,
  options: CatchUpSchedulerOptions = {},
): CatchUpScheduler {
  const debounceMs = options.debounceMs ?? CATCH_UP_DEBOUNCE_MS;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let trailing = false;

  const execute = async (): Promise<void> => {
    if (inFlight) {
      trailing = true;
      return;
    }
    inFlight = true;
    try {
      await run();
    } catch {
      // The calling hook owns error reporting; a failed catch-up must not
      // wedge the scheduler or drop the next trigger.
    } finally {
      inFlight = false;
      if (trailing) {
        trailing = false;
        await execute();
      }
    }
  };

  return {
    schedule() {
      if (timer !== null) clearTimeoutFn(timer);
      timer = setTimeoutFn(() => {
        timer = null;
        void execute();
      }, debounceMs);
    },
    runNow: execute,
    cancel() {
      if (timer !== null) {
        clearTimeoutFn(timer);
        timer = null;
      }
      trailing = false;
    },
  };
}

/**
 * The `?after=` cursor for a message list: the newest row the server actually
 * knows about. Optimistic rows are skipped — their client-side `created_at` is
 * a local clock reading, and a cursor ahead of the server's clock would skip
 * everything published in between.
 */
export function latestMessageCursor<T extends { id: string; created_at: string }>(
  messages: readonly T[],
): MessageCursor | undefined {
  let newest: T | undefined;
  for (const message of messages) {
    if (message.id.startsWith('temp-')) continue;
    if (!newest || compareMessageRows(message, newest) > 0) newest = message;
  }
  return newest ? { ts: newest.created_at, id: newest.id } : undefined;
}

/** Oldest real row — the exclusive `before` cursor for history pagination. */
export function oldestMessageCursor<T extends { id: string; created_at: string }>(
  messages: readonly T[],
): MessageCursor | undefined {
  let oldest: T | undefined;
  for (const message of messages) {
    if (message.id.startsWith('temp-')) continue;
    if (!oldest || compareMessageRows(message, oldest) < 0) oldest = message;
  }
  return oldest ? { ts: oldest.created_at, id: oldest.id } : undefined;
}

function compareMessageRows(
  a: { id: string; created_at: string },
  b: { id: string; created_at: string },
): number {
  const byTime = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A chat row this module can merge — a `Message`, structurally. */
export type CaughtUpMessage = OptimisticLike & { created_at: string };

export interface CatchUpDrainResult {
  pages: number;
  received: number;
  merged: number;
  stoppedBy: 'no-cursor' | 'empty' | 'complete' | 'max-pages' | 'repeated-cursor' | 'cancelled' | 'error';
  resumeFrom?: MessageCursor;
  error?: unknown;
}

export interface CatchUpDrainOptions<T extends CaughtUpMessage> {
  from?: MessageCursor | null;
  pageSize: number;
  maxPages: number;
  fetchPage: (after: MessageCursor) => Promise<T[]>;
  /** One bounded latest-window read when this client has no confirmed cursor. */
  fetchLatestPage?: () => Promise<T[]>;
  /** Return how many rows the caller merged for diagnostics. */
  onPage?: (page: T[]) => number | void;
  isCancelled?: () => boolean;
  /** Bounded retries for transient network, timeout, rate-limit and server failures. */
  maxRetries?: number;
  /** Injected for deterministic retry tests. */
  wait?: (milliseconds: number) => Promise<void>;
}

/**
 * Drain a reconnect gap page by page. Every request starts after the last
 * confirmed server row, so a long suspension cannot leave a permanent gap.
 */
export async function drainCatchUpPages<T extends CaughtUpMessage>(
  options: CatchUpDrainOptions<T>,
): Promise<CatchUpDrainResult> {
  const {
    from = null,
    pageSize,
    maxPages,
    fetchPage,
    fetchLatestPage,
    onPage,
    isCancelled,
    maxRetries = 2,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = options;
  let pages = 0;
  let received = 0;
  let merged = 0;
  const retryLimit = Math.max(0, maxRetries);

  const fetchWithRetry = async (fetch: () => Promise<T[]>): Promise<
    { page: T[]; error?: never } | { page?: never; error: unknown }
  > => {
    for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
      if (isCancelled?.()) return { error: new Error('Catch-up cancelled') };
      try {
        return { page: await fetch() };
      } catch (error) {
        const status = (error as { status?: unknown } | null)?.status;
        const retryable =
          typeof status !== 'number' || status === 408 || status === 429 || status >= 500;
        if (!retryable || attempt >= retryLimit) return { error };
        await wait(attempt === 0 ? 250 : 750);
      }
    }
    return { error: new Error('Catch-up request failed') };
  };

  if (!from) {
    if (!fetchLatestPage) {
      return { pages, received, merged, stoppedBy: 'no-cursor' };
    }
    const latest = await fetchWithRetry(fetchLatestPage);
    if (isCancelled?.()) return { pages, received, merged, stoppedBy: 'cancelled' };
    if (!latest.page) {
      return { pages, received, merged, stoppedBy: 'error', error: latest.error };
    }
    pages = 1;
    received = latest.page.length;
    merged = onPage?.(latest.page) ?? 0;
    return {
      pages,
      received,
      merged,
      stoppedBy: latest.page.length === 0 ? 'empty' : 'complete',
    };
  }

  let cursor = from;
  const used = new Set([`${cursor.ts}\u0000${cursor.id}`]);

  for (let index = 0; index < Math.max(1, maxPages); index += 1) {
    if (isCancelled?.()) return { pages, received, merged, stoppedBy: 'cancelled' };
    const fetched = await fetchWithRetry(() => fetchPage(cursor));
    if (isCancelled?.()) return { pages, received, merged, stoppedBy: 'cancelled' };
    if (!fetched.page) {
      return { pages, received, merged, stoppedBy: 'error', resumeFrom: cursor, error: fetched.error };
    }
    const page = fetched.page;
    pages += 1;

    if (isCancelled?.()) return { pages, received, merged, stoppedBy: 'cancelled' };
    if (page.length === 0) return { pages, received, merged, stoppedBy: 'empty' };

    received += page.length;
    merged += onPage?.(page) ?? 0;
    if (page.length < pageSize) {
      return { pages, received, merged, stoppedBy: 'complete' };
    }

    const newest = page.reduce<T | undefined>(
      (best, row) => !best || compareMessageRows(row, best) > 0 ? row : best,
      undefined,
    );
    if (!newest || newest.id.startsWith('temp-')) {
      return { pages, received, merged, stoppedBy: 'complete' };
    }
    const next = { ts: newest.created_at, id: newest.id };
    const nextKey = `${next.ts}\u0000${next.id}`;
    if (
      compareMessageRows(
        { id: next.id, created_at: next.ts },
        { id: cursor.id, created_at: cursor.ts },
      ) <= 0 ||
      used.has(nextKey)
    ) {
      return { pages, received, merged, stoppedBy: 'repeated-cursor' };
    }
    used.add(nextKey);
    cursor = next;
  }

  return { pages, received, merged, stoppedBy: 'max-pages', resumeFrom: cursor };
}

/** Merge an older or latest page by stable id, preserving optimistic rows. */
export function mergeMessagePage<T extends CaughtUpMessage>(
  current: T[],
  incoming: readonly T[],
): T[] {
  if (incoming.length === 0) return current;
  const known = new Set(current.map((message) => message.id));
  const fresh: T[] = [];
  for (const message of incoming) {
    if (known.has(message.id)) continue;
    known.add(message.id);
    fresh.push(message);
  }
  return fresh.length ? [...current, ...fresh].sort(compareChatTimeline) : current;
}

/**
 * The in-flight bubble a caught-up row confirms, if any.
 *
 * Deliberately stricter than the live-echo matcher (which falls back to the
 * sender's oldest in-flight bubble): a catch-up page holds many rows, so a
 * fallback match would let an unrelated message claim a pending bubble and
 * delete it. Content must match exactly — including the both-empty case of an
 * image-only send, which is what the fallback exists for in the echo path.
 */
function confirmedBubble<T extends CaughtUpMessage>(
  rows: readonly T[],
  incoming: { user_id: string; content: string | null },
): T | undefined {
  const content = incoming.content ?? '';
  return rows.find(
    (row) =>
      row.id.startsWith('temp-') &&
      row.status === 'sending' &&
      row.user_id === incoming.user_id &&
      (row.content ?? '') === content,
  );
}

/**
 * Merge an `?after=` page into the current list.
 *
 * Rows already present are left untouched (they may carry live reaction/edit
 * state the page predates), and a fetched row that confirms an optimistic
 * bubble replaces that bubble instead of appearing beside it — the same
 * one-message-never-twice rule the realtime echo path uses. Unmatched
 * optimistic rows are kept: dropping them would blank a send whose POST has not
 * resolved yet, even though the server page does not include it yet (the web
 * client drops every temp row here, which is what this avoids) — and they pin
 * below the page's rows until their echo confirms them (compareChatTimeline:
 * their client stamp may lag the server's).
 *
 * Returns the input array unchanged when nothing was added, so callers can hand
 * the result straight to `setState` without forcing a re-render.
 */
export function mergeCaughtUpMessages<T extends CaughtUpMessage>(
  current: T[],
  incoming: readonly T[],
): T[] {
  if (incoming.length === 0) return current;

  const known = new Set(current.map((message) => message.id));
  const fresh = incoming.filter((message) => !known.has(message.id));
  if (fresh.length === 0) return current;

  let remaining: T[] = [...current];
  const additions: T[] = [];

  for (const row of fresh) {
    // Matching against what is left means two fetched rows can never confirm
    // the same optimistic bubble.
    const matched = confirmedBubble(remaining, { user_id: row.user_id, content: row.content });
    if (matched) {
      remaining = remaining.filter((message) => message.id !== matched.id);
    }
    additions.push(row);
  }

  return [...remaining, ...additions].sort(compareChatTimeline);
}
