import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  BooleanIntentCoalescer,
  retainPendingOverrides,
} from './booleanIntentCoalescer';

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for mutation');
    await delay(10);
  }
}

test('an in-flight like survives a fresh-rows reset and is dropped once settled', async () => {
  let rendered = false;
  let finish!: (value: boolean) => void;
  const response = new Promise<boolean>((resolve) => { finish = resolve; });
  const coalescer = new BooleanIntentCoalescer({
    initialValue: false,
    quietWindowMs: 1,
    onOptimisticChange: (value) => { rendered = value; },
    persist: () => response,
  });

  coalescer.toggle();
  assert.equal(rendered, true, 'the tap paints the liked state immediately');
  const overrides = { 'threads:t1:like': { value: true, count: 4 } };

  // A list refetch lands while the POST is still in flight. Its rows predate
  // the write, so the optimistic like must be kept, not flashed away.
  const whilePending = retainPendingOverrides(overrides, () => coalescer.isPending());
  assert.deepEqual(whilePending, overrides);

  finish(true);
  await waitFor(() => !coalescer.isPending());

  // The write has settled: fresh server rows are authoritative again.
  assert.deepEqual(
    retainPendingOverrides(whilePending, () => coalescer.isPending()),
    {},
  );
  coalescer.dispose();
});

test('retainPendingOverrides keeps pending keys and drops settled ones', () => {
  const overrides = {
    'threads:t1:like': { value: true, count: 4 },
    'threads:t2:like': { value: false, count: 1 },
  };

  // Nothing dropped → the same object, so React can bail out of a re-render.
  assert.equal(retainPendingOverrides(overrides, () => true), overrides);
  assert.deepEqual(
    retainPendingOverrides(overrides, (key) => key === 'threads:t1:like'),
    { 'threads:t1:like': { value: true, count: 4 } },
  );
  // No coalescer for a key (an interaction applied from outside the tap path)
  // counts as settled.
  assert.deepEqual(retainPendingOverrides(overrides, () => false), {});
});
