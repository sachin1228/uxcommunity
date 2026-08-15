import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { BooleanIntentCoalescer } from "./boolean-intent-coalescer";

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for mutation");
    await delay(10);
  }
}

test("five rapid taps coalesce to the latest explicit state", async () => {
  const requests: boolean[] = [];
  let rendered = false;
  let persisted = false;
  const coalescer = new BooleanIntentCoalescer({
    initialValue: false,
    quietWindowMs: 20,
    onOptimisticChange: (value) => { rendered = value; },
    persist: async (desired) => {
      requests.push(desired);
      await delay(1_000);
      persisted = desired;
      return persisted;
    },
  });

  for (let index = 0; index < 5; index += 1) coalescer.toggle();
  assert.equal(rendered, true);
  await waitFor(() => persisted === true);
  assert.deepEqual(requests, [true]);
  assert.equal(rendered, true);
  coalescer.dispose();
});

test("unlike during an in-flight like cannot be overwritten by the stale response", async () => {
  const requests: boolean[] = [];
  let rendered = false;
  let persisted = false;
  const coalescer = new BooleanIntentCoalescer({
    initialValue: false,
    quietWindowMs: 10,
    onOptimisticChange: (value) => { rendered = value; },
    persist: async (desired) => {
      requests.push(desired);
      await delay(desired ? 1_000 : 100);
      persisted = desired;
      return persisted;
    },
  });

  coalescer.toggle();
  await waitFor(() => requests.length === 1);
  coalescer.toggle();
  assert.equal(rendered, false);
  await waitFor(() => requests.length === 2 && persisted === false);
  assert.deepEqual(requests, [true, false]);
  assert.equal(rendered, false);
  coalescer.dispose();
});

test("a terminal failure rolls back to the last confirmed state", async () => {
  let rendered = false;
  let reported = false;
  const coalescer = new BooleanIntentCoalescer({
    initialValue: false,
    quietWindowMs: 10,
    onOptimisticChange: (value) => { rendered = value; },
    persist: async () => {
      await delay(50);
      throw new Error("offline");
    },
    onError: () => { reported = true; },
  });

  coalescer.toggle();
  assert.equal(rendered, true);
  await waitFor(() => reported);
  assert.equal(rendered, false);
  coalescer.dispose();
});

test("onPendingChange reports pending while a write is in flight and clears on settle", async () => {
  let pendingSeen: boolean[] = [];
  let lastPending: boolean | null = null;
  const coalescer = new BooleanIntentCoalescer({
    initialValue: false,
    quietWindowMs: 10,
    onOptimisticChange: () => {},
    onPendingChange: (pending) => {
      lastPending = pending;
      pendingSeen.push(pending);
    },
    persist: async (desired) => {
      await delay(80);
      return desired;
    },
  });

  coalescer.toggle();
  assert.equal(lastPending, true, "a toggle makes the coalescer pending immediately");

  await waitFor(() => lastPending === false);
  assert.ok(pendingSeen.includes(true), "pending true was reported");
  assert.ok(pendingSeen.includes(false), "pending false was reported after settle");

  coalescer.dispose();
});
