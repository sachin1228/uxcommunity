import assert from 'node:assert/strict';
import test from 'node:test';

import { createDmReadCoalescer } from './dmReadCoalescer';

function harness() {
  let nowMs = 1_000_000;
  const timers: Array<{ id: ReturnType<typeof setTimeout>; at: number; run: () => void }> = [];
  let nextId = 1;
  const sent: string[] = [];

  const coalescer = createDmReadCoalescer({
    throttleMs: 2_000,
    send: (id) => sent.push(id),
    now: () => nowMs,
    setTimeoutFn: (handler, ms) => {
      const id = nextId++ as unknown as ReturnType<typeof setTimeout>;
      timers.push({ id, at: nowMs + ms, run: handler });
      return id;
    },
    clearTimeoutFn: (id) => {
      const index = timers.findIndex((timer) => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
  });

  function advance(ms: number) {
    nowMs += ms;
    for (const timer of [...timers]) {
      if (timer.at <= nowMs) {
        timers.splice(timers.indexOf(timer), 1);
        timer.run();
      }
    }
  }

  return { coalescer, sent, advance };
}

test('the first read is sent immediately', () => {
  const h = harness();
  h.coalescer.request('m1');
  assert.deepEqual(h.sent, ['m1']);
});

test('rapid messages produce one trailing PATCH on the newest id', () => {
  const h = harness();
  h.coalescer.request('m1');
  h.coalescer.request('m2');
  h.coalescer.request('m3');
  h.advance(1_999);
  assert.deepEqual(h.sent, ['m1']);

  h.advance(1);
  // The timer fires with the newest id, not the one pending when it started.
  assert.deepEqual(h.sent, ['m1', 'm3']);

  // Nothing else was queued.
  h.advance(10_000);
  assert.deepEqual(h.sent, ['m1', 'm3']);
});

test('a forced open read bypasses the throttle and replaces a pending timer', () => {
  const h = harness();
  h.coalescer.request('m1');
  h.coalescer.request('m2'); // timer pending
  h.coalescer.request('m3', true);
  assert.deepEqual(h.sent, ['m1', 'm3']);

  h.advance(10_000);
  assert.deepEqual(h.sent, ['m1', 'm3']);
});

test('the same newest id is never marked twice', () => {
  const h = harness();
  h.coalescer.request('m1');
  h.coalescer.request('m1');
  h.advance(10_000);
  assert.deepEqual(h.sent, ['m1']);
});

test('a later message after the throttle is sent immediately', () => {
  const h = harness();
  h.coalescer.request('m1');
  h.advance(2_001);
  h.coalescer.request('m2');
  assert.deepEqual(h.sent, ['m1', 'm2']);
});

test('cancel drops the pending trailing read', () => {
  const h = harness();
  h.coalescer.request('m1');
  h.coalescer.request('m2');
  h.coalescer.cancel();
  h.advance(10_000);
  assert.deepEqual(h.sent, ['m1']);
});
