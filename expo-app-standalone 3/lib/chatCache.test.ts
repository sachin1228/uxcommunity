/**
 * Contract for the persistent chat window (lib/chatCache.ts):
 *
 *  1. A saved window is read back on the next cold start — the conversation
 *     paints before the network answers.
 *  2. Windows are per member and per room; one room/account can never seed
 *     another.
 *  3. The store is bounded and honest about retention: optimistic rows are
 *     never persisted, the newest N rows win, and rows past the 15-day sweep
 *     are never resurrected.
 *  4. Unreadable entries and failed writes degrade to "no cache", never break
 *     the chat.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_EVENT_CACHE_LIMIT,
  COMMUNITY_MESSAGE_CACHE_LIMIT,
  DM_MESSAGE_CACHE_LIMIT,
  communityEventsCacheKey,
  communityMessagesCacheKey,
  createChatCache,
  dmMessagesCacheKey,
  type ChatCacheStorage,
} from './chatCache';
import type { Message } from './communities';
import type { ChatContentEvent } from './chatContentEvents';
import type { DmMessage } from './dm';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-18T12:00:00Z');

function at(daysAgo: number, minutes = 0): string {
  return new Date(NOW - daysAgo * DAY_MS + minutes * 60_000).toISOString();
}

function message(id: string, created_at = at(0), content = `message ${id}`): Message {
  return {
    id,
    content,
    created_at,
    user_id: 'user-a',
    reply_to_id: null,
    image_url: null,
    deleted_at: null,
    users: { name: 'A', avatar_url: null, designation: null },
    reactions: [],
    reply_to: null,
  };
}

function dmMessage(id: string, created_at = at(0)): DmMessage {
  return {
    id,
    content: `dm ${id}`,
    created_at,
    user_id: 'user-a',
    reply_to_id: null,
    image_url: null,
    deleted_at: null,
    users: null,
    reactions: [],
    reply_to: null,
  };
}

function event(id: string, created_at = at(1)): ChatContentEvent {
  return {
    id,
    community_id: 'community-a',
    user_id: 'user-a',
    kind: 'thread',
    title: `event ${id}`,
    created_at,
    reactions: [],
    users: { name: 'A', avatar_url: null },
  };
}

interface MemoryStorage extends ChatCacheStorage {
  readonly entries: Map<string, string>;
}

function memoryStorage(): MemoryStorage {
  const entries = new Map<string, string>();
  return {
    entries,
    async getItem(key) {
      return entries.get(key) ?? null;
    },
    async setItem(key, value) {
      entries.set(key, value);
    },
    async removeItem(key) {
      entries.delete(key);
    },
    async getAllKeys() {
      return [...entries.keys()];
    },
    async multiRemove(keys) {
      for (const key of keys) entries.delete(key);
    },
  };
}

function cacheOn(storage: ChatCacheStorage) {
  return createChatCache(storage, { now: () => NOW });
}

test('a saved community window is read back in timeline order', async () => {
  const storage = memoryStorage();
  const cache = cacheOn(storage);

  await cache.saveCommunityMessages('user-a', 'community-a', [
    message('m2', at(0, 2)),
    message('m1', at(0, 1)),
  ]);

  const loaded = await cache.loadCommunityMessages('user-a', 'community-a');
  assert.deepEqual(
    loaded?.map((row) => row.id),
    ['m1', 'm2'],
  );
  assert.equal(loaded?.[0].content, 'message m1');
});

test('windows are scoped per member and per room', async () => {
  const storage = memoryStorage();
  const cache = cacheOn(storage);

  await cache.saveCommunityMessages('user-a', 'community-a', [message('mine')]);
  await cache.saveCommunityMessages('user-b', 'community-a', [message('theirs')]);
  await cache.saveCommunityMessages('user-a', 'community-b', [message('other-room')]);
  await cache.saveDmMessages('user-a', 'conversation-a', [dmMessage('dm')]);

  assert.deepEqual(
    (await cache.loadCommunityMessages('user-a', 'community-a'))?.map((row) => row.id),
    ['mine'],
  );
  assert.deepEqual(
    (await cache.loadCommunityMessages('user-b', 'community-a'))?.map((row) => row.id),
    ['theirs'],
  );
  assert.deepEqual(
    (await cache.loadCommunityMessages('user-a', 'community-b'))?.map((row) => row.id),
    ['other-room'],
  );
  assert.deepEqual(
    (await cache.loadDmMessages('user-a', 'conversation-a'))?.map((row) => row.id),
    ['dm'],
  );
  assert.notEqual(
    communityMessagesCacheKey('user-a', 'community-a'),
    communityMessagesCacheKey('user-b', 'community-a'),
  );
  assert.notEqual(
    communityMessagesCacheKey('user-a', 'community-a'),
    communityMessagesCacheKey('user-a', 'community-b'),
  );
  assert.notEqual(
    communityMessagesCacheKey('user-a', 'community-a'),
    dmMessagesCacheKey('user-a', 'community-a'),
  );
});

test('optimistic rows are never persisted', async () => {
  const storage = memoryStorage();
  const cache = cacheOn(storage);

  await cache.saveCommunityMessages('user-a', 'community-a', [
    message('real'),
    { ...message('temp-1'), status: 'sending' },
  ]);

  assert.deepEqual(
    (await cache.loadCommunityMessages('user-a', 'community-a'))?.map((row) => row.id),
    ['real'],
  );
});

test('the newest rows win when the window is capped', async () => {
  const storage = memoryStorage();
  const cache = cacheOn(storage);

  const rows = Array.from({ length: COMMUNITY_MESSAGE_CACHE_LIMIT + 20 }, (_, index) =>
    message(`m${String(index).padStart(3, '0')}`, at(0, index)),
  );
  await cache.saveCommunityMessages('user-a', 'community-a', rows);

  const loaded = await cache.loadCommunityMessages('user-a', 'community-a');
  assert.equal(loaded?.length, COMMUNITY_MESSAGE_CACHE_LIMIT);
  assert.equal(loaded?.[0].id, 'm020');
  assert.equal(loaded?.[loaded.length - 1].id, 'm139');
});

test('rows past the server retention window are never resurrected', async () => {
  const storage = memoryStorage();
  const cache = cacheOn(storage);

  await cache.saveCommunityMessages('user-a', 'community-a', [
    message('expired', at(16)),
    message('edge', at(14)),
    message('fresh', at(1)),
  ]);

  assert.deepEqual(
    (await cache.loadCommunityMessages('user-a', 'community-a'))?.map((row) => row.id),
    ['edge', 'fresh'],
  );

  await cache.saveCommunityMessages('user-a', 'empty-room', [message('expired', at(20))]);
  assert.equal(
    await cache.loadCommunityMessages('user-a', 'empty-room'),
    null,
    'a window with nothing servable reports no cache',
  );
});

test('content events are cached separately and are not retention-swept', async () => {
  const storage = memoryStorage();
  const cache = cacheOn(storage);

  await cache.saveCommunityEvents('user-a', 'community-a', [
    event('old-card', at(30)),
    event('new-card', at(1)),
  ]);

  const loaded = await cache.loadCommunityEvents('user-a', 'community-a');
  assert.deepEqual(
    loaded?.map((row) => row.id),
    ['old-card', 'new-card'],
    'cards are permanent timeline items',
  );
  assert.equal(
    await cache.loadCommunityMessages('user-a', 'community-a'),
    null,
    'the messages key is untouched',
  );
  assert.notEqual(
    communityEventsCacheKey('user-a', 'community-a'),
    communityMessagesCacheKey('user-a', 'community-a'),
  );
});

test('content events keep the newest bounded window', async () => {
  const storage = memoryStorage();
  const cache = cacheOn(storage);

  const events = Array.from({ length: COMMUNITY_EVENT_CACHE_LIMIT + 5 }, (_, index) =>
    event(`e${String(index).padStart(3, '0')}`, at(0, index)),
  );
  await cache.saveCommunityEvents('user-a', 'community-a', events);

  const loaded = await cache.loadCommunityEvents('user-a', 'community-a');
  assert.equal(loaded?.length, COMMUNITY_EVENT_CACHE_LIMIT);
  assert.equal(loaded?.[0].id, 'e005');
});

test('the oldest window is evicted past the per-member cap', async () => {
  const storage = memoryStorage();
  let clock = NOW;
  const cache = createChatCache(storage, {
    now: () => clock,
    maxCachedWindows: 2,
  });

  await cache.saveCommunityMessages('user-a', 'room-1', [message('m1')]);
  clock += 1_000;
  await cache.saveCommunityMessages('user-a', 'room-2', [message('m2')]);
  clock += 1_000;
  await cache.saveCommunityMessages('user-a', 'room-3', [message('m3')]);

  assert.equal(
    await cache.loadCommunityMessages('user-a', 'room-1'),
    null,
    'the least recently written window makes room for the new one',
  );
  assert.deepEqual(
    (await cache.loadCommunityMessages('user-a', 'room-2'))?.map((row) => row.id),
    ['m2'],
  );
  assert.deepEqual(
    (await cache.loadCommunityMessages('user-a', 'room-3'))?.map((row) => row.id),
    ['m3'],
  );

  clock += 1_000;
  await cache.saveDmMessages('user-b', 'conversation-a', [dmMessage('d1')]);
  assert.deepEqual(
    (await cache.loadCommunityMessages('user-a', 'room-2'))?.map((row) => row.id),
    ['m2'],
    'another member’s windows do not evict this member’s',
  );
});

test('DM windows are bounded and retention-filtered too', async () => {
  const storage = memoryStorage();
  const cache = cacheOn(storage);

  const rows = Array.from({ length: DM_MESSAGE_CACHE_LIMIT + 10 }, (_, index) =>
    dmMessage(`d${String(index).padStart(3, '0')}`, at(0, index)),
  );
  rows.push(dmMessage('expired', at(18)));
  await cache.saveDmMessages('user-a', 'conversation-a', rows);

  const loaded = await cache.loadDmMessages('user-a', 'conversation-a');
  assert.equal(loaded?.length, DM_MESSAGE_CACHE_LIMIT);
  assert.equal(loaded?.[0].id, 'd010');
  assert.equal(loaded?.some((row) => row.id === 'expired'), false);
});

test('corrupt or foreign payloads read as no cache', async () => {
  const storage = memoryStorage();
  const cache = cacheOn(storage);
  const key = communityMessagesCacheKey('user-a', 'community-a');

  storage.entries.set(key, '{not json');
  assert.equal(await cache.loadCommunityMessages('user-a', 'community-a'), null);

  storage.entries.set(key, JSON.stringify({ version: 999, rows: [message('m1')] }));
  assert.equal(await cache.loadCommunityMessages('user-a', 'community-a'), null);

  storage.entries.set(key, JSON.stringify({ version: 1, rows: 'nope' }));
  assert.equal(await cache.loadCommunityMessages('user-a', 'community-a'), null);

  storage.entries.set(key, JSON.stringify({ version: 1, rows: [{ id: 'bad' }] }));
  assert.equal(await cache.loadCommunityMessages('user-a', 'community-a'), null);
});

test('storage failures degrade to no cache and never throw', async () => {
  const cache = createChatCache(
    {
      async getItem() {
        throw new Error('disk unavailable');
      },
      async setItem() {
        throw new Error('disk full');
      },
      async removeItem() {
        throw new Error('disk unavailable');
      },
      async getAllKeys() {
        throw new Error('disk unavailable');
      },
      async multiRemove() {
        throw new Error('disk unavailable');
      },
    },
    { now: () => NOW },
  );

  assert.equal(await cache.loadCommunityMessages('user-a', 'community-a'), null);
  await assert.doesNotReject(
    cache.saveCommunityMessages('user-a', 'community-a', [message('m1')]),
  );
  await assert.doesNotReject(cache.clearAll());
});

test('clearAll removes only this cache’s keys', async () => {
  const storage = memoryStorage();
  const cache = cacheOn(storage);

  await cache.saveCommunityMessages('user-a', 'community-a', [message('m1')]);
  await cache.saveCommunityEvents('user-a', 'community-a', [event('e1')]);
  await cache.saveDmMessages('user-a', 'conversation-a', [dmMessage('d1')]);
  storage.entries.set('@auth/uxcommunity_session', 'session');
  storage.entries.set('@community-tab-seen/v1', '{}');

  await cache.clearAll();

  assert.equal(await cache.loadCommunityMessages('user-a', 'community-a'), null);
  assert.equal(await cache.loadCommunityEvents('user-a', 'community-a'), null);
  assert.equal(await cache.loadDmMessages('user-a', 'conversation-a'), null);
  assert.equal(
    [...storage.entries.keys()].some((key) => key.includes('/index')),
    false,
    'the eviction index goes with the windows',
  );
  assert.equal(storage.entries.get('@auth/uxcommunity_session'), 'session');
  assert.equal(storage.entries.get('@community-tab-seen/v1'), '{}');
});

test('the last write wins when saves arrive back to back', async () => {
  const storage = memoryStorage();
  const cache = cacheOn(storage);

  const first = cache.saveCommunityMessages('user-a', 'community-a', [message('older')]);
  const second = cache.saveCommunityMessages('user-a', 'community-a', [message('newer')]);
  await Promise.all([first, second]);

  assert.deepEqual(
    (await cache.loadCommunityMessages('user-a', 'community-a'))?.map((row) => row.id),
    ['newer'],
  );
});
