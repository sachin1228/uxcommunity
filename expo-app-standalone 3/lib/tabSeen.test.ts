/**
 * Tests for the per-tab seen watermarks — ported from the web app's
 * tab-seen coverage. The boundary semantics matter: monotonic advances and
 * the '' baseline marker are what keep the dots honest.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  advanceTabSeen,
  createTabSeenStore,
  isNewerThan,
  newestIso,
  tabSeenStorageKey,
  type TabSeenMap,
} from './tabSeen';

/** A recording in-memory storage standing in for AsyncStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const writes: Array<[string, string]> = [];
  return {
    store,
    writes,
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      writes.push([key, value]);
      store.set(key, value);
    },
  };
}

test('the storage key is per member per community', () => {
  assert.equal(tabSeenStorageKey('u1', 'c1'), '@community-tabs/seen/u1/c1');
  assert.notEqual(tabSeenStorageKey('u1', 'c1'), tabSeenStorageKey('u2', 'c1'));
  assert.notEqual(tabSeenStorageKey('u1', 'c1'), tabSeenStorageKey('u1', 'c2'));
});

// ─── isNewerThan ──────────────────────────────────────────────────────────────

test('an untracked tab (undefined watermark) never dots', () => {
  assert.equal(isNewerThan('2026-10-16T10:00:00Z', undefined), false);
});

test('no newest item means no dot', () => {
  assert.equal(isNewerThan(null, '2026-10-16T09:00:00Z'), false);
  assert.equal(isNewerThan(null, ''), false);
});

test('the baseline marker dots for any existing item', () => {
  assert.equal(isNewerThan('2026-10-16T10:00:00Z', ''), true);
});

test('strictly newer means a dot; equal or older does not', () => {
  const seen = '2026-10-16T10:00:00Z';
  assert.equal(isNewerThan('2026-10-16T10:00:01Z', seen), true);
  assert.equal(isNewerThan(seen, seen), false);
  assert.equal(isNewerThan('2026-10-16T09:59:59Z', seen), false);
});

test('newestIso picks the newer of two, tolerating nulls', () => {
  assert.equal(newestIso(null, '2026-10-16T10:00:00Z'), '2026-10-16T10:00:00Z');
  assert.equal(newestIso('2026-10-16T10:00:00Z', null), '2026-10-16T10:00:00Z');
  assert.equal(newestIso(null, null), null);
  assert.equal(
    newestIso('2026-10-16T09:00:00Z', '2026-10-16T10:00:00Z'),
    '2026-10-16T10:00:00Z',
  );
  assert.equal(
    newestIso('2026-10-16T11:00:00Z', '2026-10-16T10:00:00Z'),
    '2026-10-16T11:00:00Z',
  );
});

// ─── advanceTabSeen (pure) ───────────────────────────────────────────────────

test('an unset tab takes the first value', () => {
  assert.deepEqual(advanceTabSeen({}, 'threads', '2026-10-16T10:00:00Z'), {
    threads: '2026-10-16T10:00:00Z',
  });
});

test('a stale or equal value never moves the watermark backwards', () => {
  const map: TabSeenMap = { threads: '2026-10-16T10:00:00Z' };
  assert.equal(advanceTabSeen(map, 'threads', '2026-10-16T09:00:00Z'), null);
  assert.equal(advanceTabSeen(map, 'threads', '2026-10-16T10:00:00Z'), null);
});

test('a newer value advances it', () => {
  const map: TabSeenMap = { threads: '2026-10-16T10:00:00Z' };
  assert.deepEqual(advanceTabSeen(map, 'threads', '2026-10-16T11:00:00Z'), {
    threads: '2026-10-16T11:00:00Z',
  });
});

test('the baseline marker fills an unset tab but never overwrites a real value', () => {
  assert.deepEqual(advanceTabSeen({}, 'threads', ''), { threads: '' });
  assert.equal(advanceTabSeen({ threads: '2026-10-16T10:00:00Z' }, 'threads', ''), null);
  // ...and a real value written later replaces the marker.
  assert.deepEqual(advanceTabSeen({ threads: '' }, 'threads', '2026-10-16T10:00:00Z'), {
    threads: '2026-10-16T10:00:00Z',
  });
  // A marker never overwrites another marker either.
  assert.equal(advanceTabSeen({ threads: '' }, 'threads', ''), null);
});

test('tabs are independent', () => {
  const map: TabSeenMap = { threads: '2026-10-16T10:00:00Z' };
  assert.deepEqual(advanceTabSeen(map, 'events', '2026-10-16T09:00:00Z'), {
    threads: '2026-10-16T10:00:00Z',
    events: '2026-10-16T09:00:00Z',
  });
});

// ─── createTabSeenStore ──────────────────────────────────────────────────────

test('read answers null until hydrated, then the persisted map', async () => {
  const storage = fakeStorage({
    '@community-tabs/seen/u1/c1': JSON.stringify({ threads: '2026-10-16T10:00:00Z' }),
  });
  const store = createTabSeenStore(storage);
  assert.equal(store.read('u1', 'c1'), null);
  const map = await store.hydrate('u1', 'c1');
  assert.deepEqual(map, { threads: '2026-10-16T10:00:00Z' });
  assert.deepEqual(store.read('u1', 'c1'), { threads: '2026-10-16T10:00:00Z' });
});

test('a never-stored key hydrates to an empty map', async () => {
  const store = createTabSeenStore(fakeStorage());
  assert.deepEqual(await store.hydrate('u1', 'c1'), {});
  assert.deepEqual(store.read('u1', 'c1'), {});
});

test('corrupt storage hydrates to an empty map', async () => {
  const store = createTabSeenStore(fakeStorage({ '@community-tabs/seen/u1/c1': 'not json' }));
  assert.deepEqual(await store.hydrate('u1', 'c1'), {});
});

test('a storage read failure still hydrates (empty map, session-only)', async () => {
  const store = createTabSeenStore({
    getItem: async () => {
      throw new Error('denied');
    },
    setItem: async () => {},
  });
  assert.deepEqual(await store.hydrate('u1', 'c1'), {});
  assert.deepEqual(store.read('u1', 'c1'), {});
});

test('hydrate is cheap to repeat and does not re-read storage', async () => {
  const storage = fakeStorage({
    '@community-tabs/seen/u1/c1': JSON.stringify({ threads: '2026-10-16T10:00:00Z' }),
  });
  const store = createTabSeenStore(storage);
  await store.hydrate('u1', 'c1');
  storage.store.set('@community-tabs/seen/u1/c1', JSON.stringify({ threads: '2099-01-01T00:00:00Z' }));
  assert.deepEqual(await store.hydrate('u1', 'c1'), { threads: '2026-10-16T10:00:00Z' });
});

test('advance updates the map, persists it, and notifies once', async () => {
  const storage = fakeStorage();
  const store = createTabSeenStore(storage);
  await store.hydrate('u1', 'c1');

  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  assert.equal(store.advance('u1', 'c1', 'threads', '2026-10-16T10:00:00Z'), true);
  assert.deepEqual(store.read('u1', 'c1'), { threads: '2026-10-16T10:00:00Z' });
  assert.equal(notifications, 1);
  assert.deepEqual(storage.writes, [
    ['@community-tabs/seen/u1/c1', JSON.stringify({ threads: '2026-10-16T10:00:00Z' })],
  ]);

  // A monotonic no-op changes nothing and notifies nobody.
  assert.equal(store.advance('u1', 'c1', 'threads', '2026-10-16T09:00:00Z'), false);
  assert.equal(notifications, 1);
  assert.equal(storage.writes.length, 1);

  unsubscribe();
});

test('a failed persist leaves the in-memory map intact', async () => {
  const store = createTabSeenStore({
    getItem: async () => null,
    setItem: async () => {
      throw new Error('quota');
    },
  });
  await store.hydrate('u1', 'c1');
  assert.equal(store.advance('u1', 'c1', 'events', '2026-10-16T10:00:00Z'), true);
  assert.deepEqual(store.read('u1', 'c1'), { events: '2026-10-16T10:00:00Z' });
});

test('communities and members keep separate watermarks', async () => {
  const storage = fakeStorage();
  const store = createTabSeenStore(storage);
  await store.hydrate('u1', 'c1');
  await store.hydrate('u1', 'c2');
  store.advance('u1', 'c1', 'threads', '2026-10-16T10:00:00Z');
  assert.deepEqual(store.read('u1', 'c2'), {});
  assert.deepEqual(store.read('u1', 'c1'), { threads: '2026-10-16T10:00:00Z' });
});
