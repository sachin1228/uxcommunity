/**
 * Tests for the chat read-state manager — the port of the web read-manager
 * suite. The PATCH is injected, so the manager runs under plain Node.
 */

import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  getReadState,
  readManagerConfig,
  resetReadManager,
  scheduleMarkRead,
} from './readManager';

const ORIGINAL_CONFIG = { ...readManagerConfig };

afterEach(() => {
  resetReadManager();
  Object.assign(readManagerConfig, ORIGINAL_CONFIG);
});

/** A patch that records calls, and can be made to fail. */
function patchCounter({ fail = false } = {}) {
  const calls: string[] = [];
  const patch = async (communityId: string) => {
    calls.push(communityId);
    if (fail) throw new Error('down');
  };
  return { calls, patch };
}

test('bursts of activity collapse into one PATCH per debounce window', async () => {
  readManagerConfig.debounceMs = 20;
  readManagerConfig.cooldownMs = 10_000;
  const { calls, patch } = patchCounter();

  for (let i = 0; i < 5; i += 1) scheduleMarkRead('c1', { patch });
  await delay(80);
  assert.equal(calls.length, 1);
});

test('the realtime cooldown gates repeats, and a user open bypasses it', async () => {
  readManagerConfig.debounceMs = 5;
  readManagerConfig.cooldownMs = 60_000;
  const { calls, patch } = patchCounter();

  scheduleMarkRead('c1', { patch }); // realtime arrival
  await delay(30);
  scheduleMarkRead('c1', { patch }); // inside the cooldown → skipped
  await delay(30);
  assert.equal(calls.length, 1);

  scheduleMarkRead('c1', { bypassCooldown: true, patch }); // opening the chat
  await delay(30);
  assert.equal(calls.length, 2);
});

test('activity during an in-flight PATCH schedules exactly one follow-up', async () => {
  readManagerConfig.debounceMs = 5;
  readManagerConfig.cooldownMs = 0;
  const calls: string[] = [];
  let release: () => void = () => {};
  const patch = async (communityId: string) => {
    calls.push(communityId);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  };

  scheduleMarkRead('c1', { patch });
  await delay(20);
  assert.equal(calls.length, 1);

  scheduleMarkRead('c1', { patch }); // while in flight
  scheduleMarkRead('c1', { patch });
  release();
  await delay(30);
  assert.equal(calls.length, 2);
});

test('a failed PATCH retries with bounded backoff', async () => {
  readManagerConfig.debounceMs = 5;
  readManagerConfig.retryMs = 10;
  readManagerConfig.maxRetries = 2;
  let attempts = 0;
  const patch = async () => {
    attempts += 1;
    throw new Error('down');
  };

  scheduleMarkRead('c1', { patch });
  await delay(150);
  // Initial attempt + two retries, then it gives up until the next event.
  assert.equal(attempts, 3);
});

test('settled states are bounded — old communities are evicted past the cap', async () => {
  readManagerConfig.debounceMs = 1;
  readManagerConfig.cooldownMs = 0;
  readManagerConfig.maxEntries = 2;
  const { patch } = patchCounter();

  for (const id of ['a', 'b', 'c']) {
    scheduleMarkRead(id, { patch });
    await delay(20); // let the PATCH settle so the entry is not protected
  }

  assert.equal(getReadState('a'), undefined);
  assert.ok(getReadState('b'));
  assert.ok(getReadState('c'));
});
