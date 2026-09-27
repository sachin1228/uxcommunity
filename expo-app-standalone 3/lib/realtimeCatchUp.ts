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

import type { OptimisticLike } from './chat';

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
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.id.startsWith('temp-')) return message.created_at;
  }
  return undefined;
}

/** A chat row this module can merge — a `Message`, structurally. */
export type CaughtUpMessage = OptimisticLike & { created_at: string };

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
 * client drops every temp row here, which is what this avoids).
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

  return [...remaining, ...additions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}
