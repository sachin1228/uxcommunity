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
  drainCatchUpPages,
  latestMessageCursor,
  mergeCaughtUpMessages,
  mergeMessagePage,
  oldestMessageCursor,
  type CaughtUpMessage,
} from './realtimeCatchUp';
import { compareChatTimeline } from './chat';

// ── A minimal Message-shaped row ───────────────────────────────────────────

interface Row extends CaughtUpMessage {
  content: string | null;
  created_at: string;
  user_id: string;
  id: string;
  status?: 'sending' | 'sent' | 'failed';
  reactions?: Array<{ emoji: string; user_ids: string[] }>;
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

test('an in-flight bubble stays last even when the page carries newer server stamps', () => {
  // The sending device's clock can lag the server's (emulator drift, manual
  // clocks): the bubble is stamped 10:06 locally while the server has already
  // committed rows stamped 10:07. It must not sort above them — a just-sent
  // bubble is the newest row on screen until its echo confirms it.
  const pending = row('temp-4-ghi', '2026-09-27T10:06:00Z', {
    id: 'temp-4-ghi',
    content: 'drifted clock',
    status: 'sending',
  });
  const current = [row('m1', '2026-09-27T10:00:00Z'), pending];
  const merged = mergeCaughtUpMessages(current, [row('m2', '2026-09-27T10:07:00Z')]);

  assert.deepEqual(
    merged.map((message) => message.id),
    ['m1', 'm2', 'temp-4-ghi'],
    'the pending bubble pins below the page rows',
  );
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

  assert.deepEqual(latestMessageCursor(messages), {
    ts: '2026-09-27T10:01:00Z',
    id: 'm2',
  });
  assert.deepEqual(oldestMessageCursor(messages), {
    ts: '2026-09-27T10:00:00Z',
    id: 'm1',
  });
});

test('compound cursors use message id to order equal timestamps', () => {
  const timestamp = '2026-09-27T10:01:00Z';
  const messages = [row('z-message', timestamp), row('a-message', timestamp)];
  assert.deepEqual(latestMessageCursor(messages), { ts: timestamp, id: 'z-message' });
  assert.deepEqual(oldestMessageCursor(messages), { ts: timestamp, id: 'a-message' });

  const merged = mergeMessagePage([], messages);
  assert.deepEqual(merged.map((message) => message.id), ['a-message', 'z-message']);
  assert.deepEqual(merged.slice().sort(compareChatTimeline).map((message) => message.id), [
    'a-message',
    'z-message',
  ]);
});

test('catch-up drains every missed page with the server compound cursor', async () => {
  const rows = Array.from({ length: 122 }, (_, index) =>
    row(`m${String(index).padStart(3, '0')}`, `2026-09-27T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`),
  );
  const calls: Array<{ ts: string; id: string }> = [];
  let window = [rows[0]];
  const result = await drainCatchUpPages({
    from: { ts: rows[0].created_at, id: rows[0].id },
    pageSize: 50,
    maxPages: 10,
    fetchPage: async (after) => {
      calls.push(after);
      const index = rows.findIndex((message) => message.id === after.id);
      return rows.slice(index + 1, index + 51);
    },
    onPage: (page) => {
      const before = window.length;
      window = mergeCaughtUpMessages(window, page);
      return window.length - before;
    },
  });

  assert.deepEqual(result, {
    pages: 3,
    received: 121,
    merged: 121,
    stoppedBy: 'complete',
  });
  assert.deepEqual(calls.map((cursor) => cursor.id), ['m000', 'm050', 'm100']);
  assert.equal(window.length, rows.length);
  assert.equal(new Set(window.map((message) => message.id)).size, rows.length);
  assert.deepEqual(window.map((message) => message.id), rows.map((message) => message.id));
});

test('an empty catch-up ends cleanly and a failed page preserves its retry cursor', async () => {
  const from = { ts: '2026-09-27T10:00:00Z', id: 'm1' };
  const empty = await drainCatchUpPages({
    from,
    pageSize: 50,
    maxPages: 10,
    fetchPage: async () => [],
  });
  assert.equal(empty.pages, 1);
  assert.equal(empty.stoppedBy, 'empty');

  const failed = await drainCatchUpPages({
    from,
    pageSize: 50,
    maxPages: 10,
    maxRetries: 0,
    fetchPage: async () => { throw new Error('offline'); },
  });
  assert.equal(failed.pages, 0);
  assert.equal(failed.stoppedBy, 'error');
  assert.deepEqual(failed.resumeFrom, from);
});

test('a room without a cursor recovers one latest window without paging history', async () => {
  const latest = row('first-after-empty', '2026-09-27T10:01:00Z');
  let latestCalls = 0;
  let afterCalls = 0;
  let window: Row[] = [];
  const result = await drainCatchUpPages({
    from: null,
    pageSize: 50,
    maxPages: 20,
    fetchLatestPage: async () => {
      latestCalls += 1;
      return [latest];
    },
    fetchPage: async () => {
      afterCalls += 1;
      return [];
    },
    onPage: (page) => {
      const before = window.length;
      window = mergeMessagePage(window, page);
      return window.length - before;
    },
  });

  assert.equal(result.stoppedBy, 'complete');
  assert.equal(result.pages, 1);
  assert.equal(latestCalls, 1);
  assert.equal(afterCalls, 0, 'the empty-room recovery does not page backward through history');
  assert.deepEqual(window.map((message) => message.id), ['first-after-empty']);
});

test('a transient page failure retries from the same confirmed cursor', async () => {
  const from = { ts: '2026-09-27T10:00:00Z', id: 'm1' };
  let attempts = 0;
  const calls: Array<{ ts: string; id: string }> = [];
  const recovered = row('m2', '2026-09-27T10:01:00Z');
  const result = await drainCatchUpPages({
    from,
    pageSize: 50,
    maxPages: 10,
    wait: async () => {},
    fetchPage: async (cursor) => {
      calls.push(cursor);
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('temporary'), { status: 503 });
      return [recovered];
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(calls, [from, from]);
  assert.equal(result.stoppedBy, 'complete');
  assert.equal(result.received, 1);
});

test('the cursor is undefined until the server has given us a message', () => {
  assert.equal(latestMessageCursor([]), undefined);
  assert.equal(
    latestMessageCursor([row('temp-5-jkl', '2026-09-27T10:00:00Z', { id: 'temp-5-jkl', status: 'sending' })]),
    undefined,
    'a chat that has only ever sent optimistically has no gap to ask for',
  );
});

// ══════════════════════════════════════════════════════════════════════════
// B. Parallel open: bootstrap snapshot vs cached cursor catch-up
// ══════════════════════════════════════════════════════════════════════════

test('catch-up and bootstrap merge in either order without a gap or duplicate', () => {
  const cached = [row('m1', '2026-09-27T10:00:00Z'), row('m2', '2026-09-27T10:01:00Z')];
  const bootstrap = [row('m1', '2026-09-27T10:00:00Z'), row('m2', '2026-09-27T10:01:00Z')];
  const gap = [row('m3', '2026-09-27T10:02:00Z')];

  const catchUpFirst = mergeCaughtUpMessages(
    mergeCaughtUpMessages(cached, gap),
    bootstrap,
  );
  const bootstrapFirst = mergeCaughtUpMessages(
    mergeCaughtUpMessages(cached, bootstrap),
    gap,
  );

  assert.deepEqual(
    catchUpFirst.map((message) => message.id),
    ['m1', 'm2', 'm3'],
  );
  assert.deepEqual(
    bootstrapFirst.map((message) => message.id),
    ['m1', 'm2', 'm3'],
  );
});

test('a message delivered by both realtime and catch-up appears once', () => {
  const current = [row('m1', '2026-09-27T10:00:00Z')];
  const fromCatchUp = [row('m2', '2026-09-27T10:01:00Z')];
  const alsoRealtime = [row('m2', '2026-09-27T10:01:00Z')];

  const once = mergeCaughtUpMessages(mergeCaughtUpMessages(current, alsoRealtime), fromCatchUp);
  assert.deepEqual(once.map((message) => message.id), ['m1', 'm2']);
});

test('messages arriving during pagination stay in timeline order', () => {
  // The hook prepends an older page, then the open catch-up adds the newest.
  const olderPage = [row('m1', '2026-09-27T10:00:00Z'), row('m2', '2026-09-27T10:01:00Z')];
  const window = [row('m3', '2026-09-27T10:02:00Z'), row('m4', '2026-09-27T10:03:00Z')];
  const newest = [row('m5', '2026-09-27T10:04:00Z')];

  const merged = mergeCaughtUpMessages([...olderPage, ...window], newest);
  assert.deepEqual(merged.map((message) => message.id), ['m1', 'm2', 'm3', 'm4', 'm5']);
});

test('an existing row keeps its newer edit/reactions when a page repeats its id', () => {
  const edited = row('m1', '2026-09-27T10:00:00Z', {
    content: 'edited text',
    reactions: [{ emoji: '👍', user_ids: ['u2'] }],
  });
  const stalePage = [row('m1', '2026-09-27T10:00:00Z', { content: 'old text' })];

  const merged = mergeCaughtUpMessages([edited], stalePage);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].content, 'edited text');
  assert.deepEqual(merged[0].reactions, [{ emoji: '👍', user_ids: ['u2'] }]);
});
