import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDmConversationsCache,
  DM_CONVERSATIONS_STALE_MS,
} from './dmConversationsCache';
import type { DmConversation } from './dm';

function conversation(id: string, name = id): DmConversation {
  return {
    id,
    peer: { id: `peer-${id}`, name, avatar_url: null },
    last_message: null,
    unread_count: 0,
    my_last_read_at: null,
    last_message_at: null,
    last_reaction: null,
    request_state: 'accepted',
    requested_by: null,
    blocked_by_me: false,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test('the page is reused inside the freshness window and reloaded after it', async () => {
  let nowMs = 1_000_000;
  let loads = 0;
  const cache = createDmConversationsCache({
    load: async () => {
      loads += 1;
      return [conversation('c1')];
    },
    now: () => nowMs,
  });

  await cache.load();
  await cache.load();
  assert.equal(loads, 1);

  nowMs += DM_CONVERSATIONS_STALE_MS;
  await cache.load();
  assert.equal(loads, 2);
});

test('a deliberate fresh read bypasses the window', async () => {
  let loads = 0;
  const cache = createDmConversationsCache({
    load: async () => {
      loads += 1;
      return [conversation('c1')];
    },
  });

  await cache.load();
  await cache.load({ fresh: true });
  assert.equal(loads, 2);
});

test('concurrent list and thread reads share one request', async () => {
  const pending = deferred<DmConversation[]>();
  let loads = 0;
  const cache = createDmConversationsCache({
    load: () => {
      loads += 1;
      return pending.promise;
    },
  });

  const list = cache.load();
  const thread = cache.load();
  pending.resolve([conversation('c1')]);

  assert.deepEqual(await Promise.all([list, thread]), [
    [conversation('c1')],
    [conversation('c1')],
  ]);
  assert.equal(loads, 1);
});

test('a local mutation made during a fetch is not overwritten by the page', async () => {
  const pending = deferred<DmConversation[]>();
  let nowMs = 1_000_000;
  const cache = createDmConversationsCache({
    load: () => pending.promise,
    now: () => nowMs,
  });
  cache.seedFromDisk([conversation('c1', 'Old peer')]);

  const reading = cache.load();
  nowMs += 100;
  cache.put({ ...cache.peekOne('c1')!, request_state: 'accepted', blocked_by_me: true });
  nowMs += 100;
  pending.resolve([conversation('c1', 'Server peer')]);

  const rows = await reading;
  assert.equal(rows[0].blocked_by_me, true);
  assert.equal(rows[0].peer.name, 'Old peer');
  assert.equal(cache.peekOne('c1')?.blocked_by_me, true);
});

test('a brand-new thread opened during a list fetch survives the merge', async () => {
  const pending = deferred<DmConversation[]>();
  let nowMs = 2_000_000;
  const cache = createDmConversationsCache({
    load: () => pending.promise,
    now: () => nowMs,
  });
  cache.seedFromDisk([conversation('c1')]);

  const reading = cache.load();
  nowMs += 10;
  cache.put(conversation('new'));
  nowMs += 10;
  pending.resolve([conversation('c1')]);

  const rows = await reading;
  assert.deepEqual(rows.map((row) => row.id).sort(), ['c1', 'new']);
});

test('a seeded disk snapshot is never treated as fresh', async () => {
  let loads = 0;
  const cache = createDmConversationsCache({
    load: async () => {
      loads += 1;
      return [conversation('server')];
    },
  });
  cache.seedFromDisk([conversation('disk')]);
  assert.equal(cache.peekOne('disk')?.id, 'disk');

  await cache.load();
  assert.equal(loads, 1);
  assert.equal(cache.peekOne('server')?.id, 'server');
});

test('clear drops the page and any local mutation markers', async () => {
  let loads = 0;
  const cache = createDmConversationsCache({
    load: async () => {
      loads += 1;
      return [conversation('server')];
    },
  });
  await cache.load();
  cache.put(conversation('local'));
  cache.clear();

  assert.equal(cache.peek(), null);
  const rows = await cache.load();
  assert.deepEqual(rows.map((row) => row.id), ['server']);
  assert.equal(loads, 2);
});

test('no active member sees or writes the shared page', async () => {
  let loads = 0;
  const cache = createDmConversationsCache({
    load: async () => {
      loads += 1;
      return [conversation('server')];
    },
  });
  cache.setActiveUser(null);
  cache.seedFromDisk([conversation('disk')]);
  cache.put(conversation('local'));

  assert.equal(cache.peek(), null);
  assert.equal(cache.peekOne('disk'), null);
  assert.deepEqual(await cache.load(), []);
  assert.equal(loads, 0);
});

test('a page from the previous member cannot populate the next member', async () => {
  const pending = deferred<DmConversation[]>();
  const cache = createDmConversationsCache({
    load: () => pending.promise,
  });
  cache.setActiveUser('user-a');
  cache.seedFromDisk([conversation('a-seed')]);
  const reading = cache.load();

  cache.setActiveUser('user-b');
  pending.resolve([conversation('a-server')]);
  await reading;

  assert.equal(cache.peek(), null);
  assert.equal(cache.peekOne('a-server'), null);
});
