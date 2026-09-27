/**
 * Tests for realtime gap recovery helpers.
 *
 * The contract the hooks rely on:
 *
 *  1. A burst of reconnect/foreground triggers produces ONE fetch, and a
 *     trigger that lands mid-fetch produces at most one trailing run — never
 *     two requests in flight at once.
 *  2. The `?after=` cursor is the newest real message, so an optimistic send
 *     (whose local clock reading can be ahead of the server) never skips
 *     messages that arrived in the gap.
 *  3. Merging a caught-up page never shows a message twice, never loses an
 *     optimistic bubble whose send is still in flight, and returns the same
 *     array when the gap was empty (so React does not re-render for nothing).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCatchUpScheduler,
  latestMessageCursor,
  mergeCaughtUpMessages,
  type CaughtUpMessage,
} from './realtimeCatchUp';

// ── A minimal Message-shaped row ───────────────────────────────────────────

interface Row extends CaughtUpMessage {
  content: string | null;
  created_at: string;
  user_id: string;
  id: string;
  status?: 'sending' | 'sent' | 'failed';
}

function row(id: string, created_at: string, extra: Partial<Row> = {}): Row {
  return {
    id,
    created_at,
    user_id: 'user-a',
    content: `message ${id}`,
    status: 'sent',
    ...extra,
  };
}

/** Timer harness: lets a test advance the debounce deterministically. */
function fakeTimers() {
  let now = 0;
  const scheduled = new Map<number, { at: number; run: () => void }>();
  let nextId = 1;

  return {
    setTimeoutFn: (handler: () => void, ms: number): ReturnType<typeof setTimeout> => {
      const id = nextId as unknown as ReturnType<typeof setTimeout>;
      nextId += 1;
      scheduled.set(id as unknown as number, { at: now + ms, run: handler });
      return id;
    },
    clearTimeoutFn: (timer: ReturnType<typeof setTimeout>): void => {
      scheduled.delete(timer as unknown as number);
    },
    /** Run everything due after `ms` of virtual time. */
    advance(ms: number): void {
      now += ms;
      for (const [id, entry] of [...scheduled]) {
        if (entry.at <= now) {
          scheduled.delete(id);
          entry.run();
        }
      }
    },
    pending(): number {
      return scheduled.size;
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// A/B. One catch-up per burst, one at a time
// ══════════════════════════════════════════════════════════════════════════

test('a burst of reconnect triggers collapses into a single catch-up run', () => {
  const timers = fakeTimers();
  let runs = 0;
  const scheduler = createCatchUpScheduler(
    () => {
      runs += 1;
    },
    { debounceMs: 300, ...timers },
  );

  // Reconnect signal, heartbeat recycle and the foreground probe all land
  // within the debounce window of a Wi-Fi → LTE switch.
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  timers.advance(299);
  assert.equal(runs, 0, 'the burst has not settled yet');
  timers.advance(1);
  assert.equal(runs, 1, 'one fetch for the whole burst');
  assert.equal(timers.pending(), 0);
});

test('a trigger during an in-flight fetch runs exactly once more, after it settles', async () => {
  const timers = fakeTimers();
  const order: string[] = [];
  let release: (() => void) | null = null;

  const scheduler = createCatchUpScheduler(
    () =>
      new Promise<void>((resolve) => {
        order.push('start');
        release = () => {
          order.push('done');
          resolve();
        };
      }),
    { debounceMs: 300, ...timers },
  );

  scheduler.schedule();
  timers.advance(300);
  assert.deepEqual(order, ['start'], 'the first run is in flight');

  // Three more triggers land while the request is open.
  scheduler.schedule();
  timers.advance(300);
  scheduler.schedule();
  timers.advance(300);
  assert.deepEqual(order, ['start'], 'no second request runs concurrently');

  release!();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(order, ['start', 'done', 'start'], 'one trailing run honours the triggers');

  release!();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(order, ['start', 'done', 'start', 'done'], 'and then the scheduler is idle');
});

test('cancel() drops a queued run without disturbing one already in flight', async () => {
  const timers = fakeTimers();
  let runs = 0;
  const scheduler = createCatchUpScheduler(() => {
    runs += 1;
  }, { debounceMs: 300, ...timers });

  scheduler.schedule();
  scheduler.cancel();
  timers.advance(500);
  assert.equal(runs, 0, 'an unmounted screen never fetches');

  await scheduler.runNow();
  assert.equal(runs, 1, 'an explicit run still works');
});

test('a failing catch-up does not wedge the scheduler', async () => {
  const timers = fakeTimers();
  let attempts = 0;
  const scheduler = createCatchUpScheduler(
    () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
    },
    { debounceMs: 300, ...timers },
  );

  scheduler.schedule();
  timers.advance(300);
  await Promise.resolve();
  await Promise.resolve();

  scheduler.schedule();
  timers.advance(300);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(attempts, 2, 'the next trigger still runs after a failure');
});

// ══════════════════════════════════════════════════════════════════════════
// A. Merge — recovering the gap without duplicates
// ══════════════════════════════════════════════════════════════════════════

test('catch-up merge appends missed messages exactly once and keeps order', () => {
  const current = [row('m1', '2026-09-27T10:00:00Z'), row('m2', '2026-09-27T10:01:00Z')];
  const fetched = [
    row('m3', '2026-09-27T10:02:00Z'),
    // The server can hand back a row the client already has when the gap
    // boundary sits on the same timestamp.
    row('m2', '2026-09-27T10:01:00Z'),
  ];

  const merged = mergeCaughtUpMessages(current, fetched);
  assert.deepEqual(
    merged.map((message) => message.id),
    ['m1', 'm2', 'm3'],
    'each message appears once, in time order',
  );
});

test('an empty catch-up page keeps the array identity so nothing re-renders', () => {
  const current = [row('m1', '2026-09-27T10:00:00Z')];
  assert.equal(mergeCaughtUpMessages(current, []), current);
  assert.equal(mergeCaughtUpMessages(current, [row('m1', '2026-09-27T10:00:00Z')]), current);
});

test('a caught-up row confirms an optimistic bubble instead of duplicating it', () => {
  const pending = row('temp-1-abc', '2026-09-27T10:05:00Z', {
    id: 'temp-1-abc',
    content: 'hello there',
    status: 'sending',
  });
  const current = [row('m1', '2026-09-27T10:00:00Z'), pending];

  // The echo of that send was published while the socket was down, so the
  // catch-up page is where it finally arrives.
  const fetched = [row('m9', '2026-09-27T10:05:00Z', { content: 'hello there' })];
  const merged = mergeCaughtUpMessages(current, fetched);

  assert.deepEqual(
    merged.map((message) => message.id),
    ['m1', 'm9'],
    'the optimistic bubble is replaced, not duplicated',
  );
});

test('a send whose POST has not resolved yet is never dropped by a catch-up', () => {
  const pending = row('temp-2-xyz', '2026-09-27T10:06:00Z', {
    id: 'temp-2-xyz',
    content: 'still uploading',
    status: 'sending',
  });
  const current = [row('m1', '2026-09-27T10:00:00Z'), pending];

  // The page does not include it (the server has not committed it yet).
  const merged = mergeCaughtUpMessages(current, [row('m2', '2026-09-27T10:01:00Z')]);

  assert.deepEqual(
    merged.map((message) => message.id),
    ['m1', 'm2', 'temp-2-xyz'],
    'the in-flight bubble survives and keeps its status',
  );
  assert.equal(merged[2].status, 'sending');
});

test('an image-only send is confirmed by a content-less page row', () => {
  // Image messages carry no text on either side, so the both-empty case is the
  // one the echo path's fallback matcher exists for — the merge must handle it
  // without that looser fallback.
  const uploading = row('temp-6-mno', '2026-09-27T10:10:00Z', {
    id: 'temp-6-mno',
    content: null,
    status: 'sending',
  });
  const merged = mergeCaughtUpMessages(
    [uploading],
    [row('m7', '2026-09-27T10:10:05Z', { content: null })],
  );

  assert.deepEqual(merged.map((message) => message.id), ['m7']);
});

test('two fetched rows cannot confirm the same optimistic bubble', () => {
  const pending = row('temp-3-def', '2026-09-27T10:06:00Z', {
    id: 'temp-3-def',
    content: 'same text',
    status: 'sending',
  });
  const merged = mergeCaughtUpMessages(
    [pending],
    [
      row('m4', '2026-09-27T10:07:00Z', { content: 'same text' }),
      row('m5', '2026-09-27T10:08:00Z', { content: 'same text' }),
    ],
  );

  assert.deepEqual(
    merged.map((message) => message.id),
    ['m4', 'm5'],
    'only one bubble is claimed; the second row stands on its own',
  );
});

// ══════════════════════════════════════════════════════════════════════════
// A. Cursor selection
// ══════════════════════════════════════════════════════════════════════════

test('the catch-up cursor is the newest real message, never an optimistic one', () => {
  const messages = [
    row('m1', '2026-09-27T10:00:00Z'),
    row('m2', '2026-09-27T10:01:00Z'),
    // A local clock reading that can sit ahead of the server's.
    row('temp-4-ghi', '2026-09-27T10:09:00Z', { id: 'temp-4-ghi', status: 'sending' }),
  ];

  assert.equal(latestMessageCursor(messages), '2026-09-27T10:01:00Z');
});

test('the cursor is undefined until the server has given us a message', () => {
  assert.equal(latestMessageCursor([]), undefined);
  assert.equal(
    latestMessageCursor([row('temp-5-jkl', '2026-09-27T10:00:00Z', { id: 'temp-5-jkl', status: 'sending' })]),
    undefined,
    'a chat that has only ever sent optimistically has no gap to ask for',
  );
});
