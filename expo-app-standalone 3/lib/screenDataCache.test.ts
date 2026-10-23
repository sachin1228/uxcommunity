import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SCREEN_CACHE_LIMITS,
  ScreenDataCache,
  mergeUniquePage,
  type ScreenCacheStorage,
} from './screenDataCache';

class MemoryStorage implements ScreenCacheStorage {
  values = new Map<string, string>();
  failReads = false;
  failWrites = false;
  failRemoves = false;

  async getItem(key: string): Promise<string | null> {
    if (this.failReads) throw new Error('read failed');
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error('write failed');
    this.values.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    if (this.failRemoves) throw new Error('remove failed');
    this.values.delete(key);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const limits = { ...DEFAULT_SCREEN_CACHE_LIMITS };

test('cache miss fetches once, dedupes simultaneous requests, and paints the stored result', async () => {
  const storage = new MemoryStorage();
  let now = 100;
  const cache = new ScreenDataCache(storage, () => now, limits);
  cache.activateSession('member-a', 1);
  const page = deferred<{ rows: string[] }>();
  let requests = 0;
  const load = () => {
    requests += 1;
    return page.promise;
  };

  const first = cache.fetch('member-a', 'home:all', 1, 500, load);
  const second = cache.fetch('member-a', 'home:all', 1, 500, load);
  assert.equal(requests, 1);
  page.resolve({ rows: ['one'] });
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.accepted), [true, true]);
  assert.deepEqual(cache.peek('member-a', 'home:all', 1, 500)?.data, { rows: ['one'] });
  await cache.flushWrites('member-a');

  const restored = new ScreenDataCache(storage, () => now, limits);
  restored.activateSession('member-a', 1);
  assert.equal((await restored.read<{ rows: string[] }>('member-a', 'home:all', 1, 500))?.isFresh, true);
  now = 700;
  assert.equal((await restored.read('member-a', 'home:all', 1, 500))?.isFresh, false);
});

test('authoritative fetch results do not wait for slow disk persistence', async () => {
  const storage = new MemoryStorage();
  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  const gatedStorage: ScreenCacheStorage = {
    getItem: (key) => storage.getItem(key),
    setItem: async (key, value) => {
      writeStarted.resolve();
      await releaseWrite.promise;
      await storage.setItem(key, value);
    },
    removeItem: (key) => storage.removeItem(key),
  };
  const cache = new ScreenDataCache(gatedStorage, () => 100, limits);
  cache.activateSession('member-a', 1);
  const response = deferred<{ rows: string[] }>();
  const resultPromise = cache.fetch('member-a', 'feed', 1, 500, () => response.promise);
  response.resolve({ rows: ['authoritative'] });
  const result = await resultPromise;
  assert.equal(result.accepted, true);
  assert.deepEqual(cache.peek('member-a', 'feed', 1, 500)?.data, { rows: ['authoritative'] });
  await writeStarted.promise;
  releaseWrite.resolve();
  await cache.flushWrites('member-a');
});

test('stale snapshots remain available offline while failed refreshes do not replace them', async () => {
  const storage = new MemoryStorage();
  const cache = new ScreenDataCache(storage, () => 1_000, limits);
  cache.activateSession('member-a', 3);
  await cache.write('member-a', 'jobs', 3, { ids: ['job-1'] }, 100);
  await assert.rejects(
    cache.fetch('member-a', 'jobs', 3, 100, async () => {
      throw new Error('offline');
    }),
    /offline/,
  );
  assert.deepEqual(cache.peek<{ ids: string[] }>('member-a', 'jobs', 3, 100)?.data, {
    ids: ['job-1'],
  });
});

test('a mutation revision rejects a late server page so it cannot undo the newer value', async () => {
  const cache = new ScreenDataCache(new MemoryStorage(), () => 2_000, limits);
  cache.activateSession('member-a', 4);
  const response = deferred<{ applied: boolean }>();
  const refresh = cache.fetch('member-a', 'jobs', 4, 1_000, () => response.promise);
  await cache.write('member-a', 'jobs', 4, { applied: true }, 1_000);
  response.resolve({ applied: false });
  const result = await refresh;
  assert.equal(result.accepted, false);
  assert.deepEqual(cache.peek('member-a', 'jobs', 4, 1_000)?.data, { applied: true });
});

test('a refresh after a mutation starts a new request instead of joining the stale flight', async () => {
  const cache = new ScreenDataCache(new MemoryStorage(), () => 2_500, limits);
  cache.activateSession('member-a', 4);
  const oldResponse = deferred<{ value: string }>();
  const newResponse = deferred<{ value: string }>();
  const oldRequest = cache.fetch('member-a', 'explore', 4, 1_000, () => oldResponse.promise);
  await cache.write('member-a', 'explore', 4, { value: 'mutation' }, 1_000);
  const newRequest = cache.fetch('member-a', 'explore', 4, 1_000, () => newResponse.promise);
  oldResponse.resolve({ value: 'old' });
  assert.equal((await oldRequest).accepted, false);
  newResponse.resolve({ value: 'authoritative' });
  assert.equal((await newRequest).accepted, true);
  assert.deepEqual(cache.peek('member-a', 'explore', 4, 1_000)?.data, {
    value: 'authoritative',
  });
});

test('account switches fence both pending fetches and disk reads', async () => {
  const storage = new MemoryStorage();
  const cache = new ScreenDataCache(storage, () => 5_000, limits);
  cache.activateSession('member-a', 7);
  await cache.write('member-a', 'profile', 7, { name: 'A' }, 10_000);

  const response = deferred<{ private: string }>();
  const pending = cache.fetch('member-a', 'jobs', 7, 1_000, () => response.promise);
  cache.activateSession('member-b', 8);
  assert.equal(await cache.read('member-a', 'profile', 7, 10_000), null);
  assert.equal(await cache.write('member-a', 'jobs', 7, { private: 'late' }, 1_000), false);
  response.resolve({ private: 'late' });
  assert.equal((await pending).accepted, false);
  assert.equal(cache.peek('member-b', 'jobs', 8, 1_000), null);
});

test('a disk read that finishes after an account switch cannot hydrate the new session', async () => {
  const storage = new MemoryStorage();
  const readStarted = deferred<void>();
  const releaseRead = deferred<string | null>();
  const gatedStorage: ScreenCacheStorage = {
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
    getItem: async (key) => {
      readStarted.resolve();
      return releaseRead.promise;
    },
  };
  const cache = new ScreenDataCache(gatedStorage, () => 6_000, limits);
  cache.activateSession('member-a', 10);
  const read = cache.read('member-a', 'own-profile', 10, 1_000);
  await readStarted.promise;
  cache.activateSession('member-b', 11);
  releaseRead.resolve(
    JSON.stringify({
      version: 1,
      entries: {
        'own-profile': { updatedAt: 6_000, expiresAt: 7_000, data: { name: 'A' } },
      },
    }),
  );
  assert.equal(await read, null);
  assert.equal(cache.peek('member-b', 'own-profile', 11, 1_000), null);
});

test('clear is account scoped and waits behind an in-progress write', async () => {
  const storage = new MemoryStorage();
  const cache = new ScreenDataCache(storage, () => 10_000, limits);
  cache.activateSession('member-a', 1);
  await cache.write('member-a', 'feed', 1, { rows: ['private'] }, 1_000);
  cache.activateSession('member-b', 2);
  await cache.write('member-b', 'feed', 2, { rows: ['other'] }, 1_000);
  await cache.clearOwner('member-a');
  assert.equal(await cache.read('member-a', 'feed', 1, 1_000), null);
  assert.deepEqual(cache.peek('member-b', 'feed', 2, 1_000)?.data, { rows: ['other'] });

  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  const delayedStorage: ScreenCacheStorage = {
    getItem: (key) => storage.getItem(key),
    setItem: async (key, value) => {
      writeStarted.resolve();
      await releaseWrite.promise;
      await storage.setItem(key, value);
    },
    removeItem: (key) => storage.removeItem(key),
  };
  const delayedCache = new ScreenDataCache(delayedStorage, () => 10_000, limits);
  delayedCache.activateSession('member-c', 3);
  const pendingWrite = delayedCache.write('member-c', 'feed', 3, { rows: ['late'] }, 1_000);
  await writeStarted.promise;
  const pendingClear = delayedCache.clearOwner('member-c');
  releaseWrite.resolve();
  await Promise.all([pendingWrite, pendingClear]);
  assert.equal([...storage.values.keys()].some((key) => key.endsWith('member-c')), false);
});

test('storage failures are best effort and cache bounds evict old entries', async () => {
  const storage = new MemoryStorage();
  const smallLimits = { maxEntries: 1, maxBytes: 4_096, maxEntryBytes: 2_048 };
  const cache = new ScreenDataCache(storage, () => 20_000, smallLimits);
  cache.activateSession('member-a', 9);
  storage.failWrites = true;
  assert.equal(await cache.write('member-a', 'explore', 9, { ok: true }, 1_000), true);
  assert.deepEqual(cache.peek('member-a', 'explore', 9, 1_000)?.data, { ok: true });
  storage.failWrites = false;
  await cache.write('member-a', 'jobs', 9, { ok: 'new' }, 1_000);
  assert.equal(cache.peek('member-a', 'explore', 9, 1_000), null);
  assert.deepEqual(cache.peek('member-a', 'jobs', 9, 1_000)?.data, { ok: 'new' });
  storage.failReads = true;
  const cold = new ScreenDataCache(storage, () => 20_000, smallLimits);
  cold.activateSession('member-a', 9);
  assert.equal(await cold.read('member-a', 'jobs', 9, 1_000), null);
  storage.failRemoves = true;
  await assert.doesNotReject(cache.clearOwner('member-a'));
});

test('pagination merges unique ids while retaining the existing order', () => {
  assert.deepEqual(
    mergeUniquePage([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }], (item) => item.id),
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  );
});
