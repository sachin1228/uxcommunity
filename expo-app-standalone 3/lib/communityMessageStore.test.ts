import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createCommunityMessageStore, enrichMessagePreviews } from './communityMessageStore';
import type { CommunityMessageWindow } from './chatCache';
import type { Message } from './communities';
import { latestMessageCursor } from './realtimeCatchUp';

const NOW = Date.parse('2026-11-04T12:00:00Z');
function row(n: number, extra: Partial<Message> = {}): Message {
  return { id: `m${n}`, content: `message ${n}`, created_at: new Date(NOW - 60_000 + n * 100).toISOString(),
    user_id: 'sender', image_url: null, reply_to_id: null, deleted_at: null,
    users: null, reactions: [], reply_to: null, ...extra };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(t: TestContext, disk: CommunityMessageWindow | null = null, maxRooms = 40) {
  const requests: string[] = [];
  const saved: Array<{ owner: string; room: string; window: CommunityMessageWindow }> = [];
  const io = {
    load: async (_owner: string, _room: string) => disk,
    latest: async (_room: string): Promise<Message[]> => [],
    after: async (_room: string, _id: string): Promise<Message[]> => [],
  };
  const store = createCommunityMessageStore({
    now: () => NOW, maxRooms, writeDelayMs: 60_000,
    load: (owner, room) => io.load(owner, room),
    save: async (owner, room, window) => { saved.push({ owner, room, window }); },
    fetchLatest: (room) => { requests.push(`latest:${room}`); return io.latest(room); },
    fetchAfter: (room, cursor) => { requests.push(`after:${room}:${cursor.id}`); return io.after(room, cursor.id); },
  });
  store.activateUser('member');
  t.after(() => store.activateUser(null));
  return { store, io, requests, saved };
}
const snapshot = (messages: Message[]): CommunityMessageWindow => ({ messages, syncedThrough: latestMessageCursor(messages) ?? null });
const ids = (messages: Message[] | undefined) => messages?.map((message) => message.id);

test('API pages fill push/realtime quote previews without replacing newer local state', () => {
  const current = row(2, { content: 'new edit', image_url: 'file://preview',
    reactions: [{ emoji: '👍', user_ids: ['member'] }] });
  const full = row(2, { users: { name: 'Sender', avatar_url: null, designation: null },
    reply_to: { id: 'm1', content: 'quoted text', user_name: 'Parent' } });
  const enriched = enrichMessagePreviews([current], [full])[0];
  assert.equal(enriched.reply_to?.content, 'quoted text');
  assert.equal(enriched.users?.name, 'Sender');
  assert.equal(enriched.content, 'new edit');
  assert.equal(enriched.image_url, 'file://preview');
  assert.deepEqual(enriched.reactions, current.reactions);
});

test('API reconciliation applies a later edit or deletion to a pushed snapshot', () => {
  const pushed = row(2);
  const edited = enrichMessagePreviews([pushed], [row(2, { content: 'edited later', edited_at: '2026-11-04T12:01:00Z' })])[0];
  assert.equal(edited.content, 'edited later');
  const deleted = enrichMessagePreviews([edited], [row(2, { deleted_at: '2026-11-04T12:02:00Z' })])[0];
  assert.equal(deleted.content, null);
  assert.ok(deleted.deleted_at);
});

test('disk messages are observable before a stalled network responds', async (t) => {
  const { store, io, requests } = setup(t, snapshot([row(1)]));
  const response = deferred<Message[]>();
  io.after = () => response.promise;
  await store.hydrate('member', 'room');
  const sync = store.sync('member', 'room');
  await Promise.resolve();
  assert.deepEqual(ids(store.peek('member', 'room')?.messages), ['m1']);
  assert.deepEqual(requests, ['after:room:m1']);
  response.resolve([row(2)]);
  await sync;
  assert.deepEqual(ids(store.peek('member', 'room')?.messages), ['m1', 'm2']);
});

test('a received message is immediately available to an unopened chat and persists with its checkpoint', async (t) => {
  const { store, saved } = setup(t, snapshot([row(1)]));
  store.remember('member', 'room', [row(3)]);
  assert.deepEqual(ids(store.peek('member', 'room')?.messages), ['m3']);
  await store.hydrate('member', 'room');
  assert.deepEqual(ids(store.peek('member', 'room')?.messages), ['m1', 'm3']);
  store.flush();
  assert.equal(saved[0].window.syncedThrough?.id, 'm1');
  assert.deepEqual(ids(saved[0].window.messages), ['m1', 'm3']);
});

test('a newer live arrival cannot skip an older missed message', async (t) => {
  const { store, io, requests } = setup(t, snapshot([row(1)]));
  await store.hydrate('member', 'room');
  store.remember('member', 'room', [row(3)]);
  io.after = async () => [row(2), row(3)];
  await store.sync('member', 'room');
  assert.deepEqual(requests, ['after:room:m1']);
  assert.deepEqual(ids(store.peek('member', 'room')?.messages), ['m1', 'm2', 'm3']);
  assert.equal(store.peek('member', 'room')?.syncedThrough?.id, 'm3');
});

test('a restart preserves a gap checkpoint separately from displayed live messages', async (t) => {
  const { store, io, requests } = setup(t, { messages: [row(1), row(8)], syncedThrough: latestMessageCursor([row(1)])! });
  io.after = async () => Array.from({ length: 7 }, (_, index) => row(index + 2));
  await store.sync('member', 'room');
  assert.deepEqual(requests, ['after:room:m1']);
  assert.equal(store.peek('member', 'room')?.messages.length, 8);
});

test('a live-only window uses a latest-page read, even after persistence', async (t) => {
  const { store, io, requests } = setup(t, { messages: [row(8)], syncedThrough: null });
  io.latest = async () => [row(6), row(7), row(8)];
  await store.sync('member', 'room');
  assert.deepEqual(requests, ['latest:room']);
  assert.deepEqual(ids(store.peek('member', 'room')?.messages), ['m6', 'm7', 'm8']);
});

test('press-in, notification tap and mount share a single in-flight read', async (t) => {
  const { store, io, requests } = setup(t);
  const response = deferred<Message[]>();
  io.latest = () => response.promise;
  const first = store.sync('member', 'room');
  assert.equal(store.sync('member', 'room'), first);
  await store.hydrate('member', 'room');
  response.resolve([row(1)]);
  await first;
  await store.sync('member', 'room');
  assert.deepEqual(requests, ['latest:room']);
});

test('a socket opening during an HTTP read gets one trailing recovery read', async (t) => {
  const { store, io, requests } = setup(t);
  const response = deferred<Message[]>();
  io.latest = () => response.promise;
  io.after = async () => [row(2)];
  const sync = store.sync('member', 'room');
  await store.hydrate('member', 'room');
  store.sync('member', 'room', true);
  store.sync('member', 'room', true);
  response.resolve([row(1)]);
  await sync;
  assert.deepEqual(requests, ['latest:room', 'after:room:m1']);
  assert.deepEqual(ids(store.peek('member', 'room')?.messages), ['m1', 'm2']);
});

test('a catch-up page advances its own cursor rather than the newest live row', async (t) => {
  const { store, io, requests } = setup(t, snapshot([row(1)]));
  await store.hydrate('member', 'room');
  store.remember('member', 'room', [row(100)]);
  io.after = async (_room, id) => id === 'm1'
    ? Array.from({ length: 50 }, (_, index) => row(index + 2)) : [row(52)];
  await store.sync('member', 'room');
  assert.deepEqual(requests, ['after:room:m1', 'after:room:m51']);
  assert.equal(store.peek('member', 'room')?.syncedThrough?.id, 'm52');
});

test('late disk and network reads cannot cross an account switch', async (t) => {
  const { store, io, saved } = setup(t);
  const disk = deferred<CommunityMessageWindow | null>();
  io.load = () => disk.promise;
  const sync = store.sync('member', 'room');
  store.activateUser('other');
  disk.resolve(snapshot([row(1)]));
  await sync;
  assert.equal(store.peek('other', 'room'), null);
  assert.equal(store.peek('member', 'room'), null);
  assert.equal(saved.length, 0);
});

test('a late network response from a previous login cannot repopulate the same account', async (t) => {
  const { store, io } = setup(t);
  const response = deferred<Message[]>();
  io.latest = () => response.promise;
  const sync = store.sync('member', 'room');
  await store.hydrate('member', 'room');
  store.activateUser(null);
  store.activateUser('member');
  response.resolve([row(1)]);
  await sync;
  assert.equal(store.peek('member', 'room'), null);
});

test('edits received during disk hydration are applied to the restored row', async (t) => {
  const { store, io, saved } = setup(t);
  const disk = deferred<CommunityMessageWindow | null>();
  io.load = () => disk.promise;
  store.update('member', 'room', (rows) => rows.map((message) => ({ ...message, content: 'edited' })));
  disk.resolve(snapshot([row(1)]));
  await store.hydrate('member', 'room');
  store.flush();
  assert.equal(store.peek('member', 'room')?.messages[0].content, 'edited');
  assert.equal(saved.at(-1)?.window.messages[0].content, 'edited');
});

test('optimistic rows and duplicates do not trigger store notifications or writes', async (t) => {
  const { store } = setup(t, snapshot([row(1)]));
  await store.hydrate('member', 'room');
  let notifications = 0;
  store.subscribe('member', 'room', () => { notifications++; });
  store.remember('member', 'room', [row(1), row(2, { id: 'temp-2' })]);
  assert.equal(notifications, 0);
  assert.deepEqual(ids(store.peek('member', 'room')?.messages), ['m1']);
});

test('retention and bounded windows apply to live messages as well as disk rows', async (t) => {
  const { store } = setup(t);
  store.remember('member', 'room', [row(0, { created_at: new Date(NOW - 16 * 86_400_000).toISOString() }),
    ...Array.from({ length: 130 }, (_, index) => row(index + 1))]);
  await store.hydrate('member', 'room');
  const messages = store.peek('member', 'room')!.messages;
  assert.equal(messages.length, 120);
  assert.equal(messages[0].id, 'm11');
  assert.equal(messages.at(-1)?.id, 'm130');
});

test('empty chats are persisted and can receive their first message on the next sync', async (t) => {
  const { store, io, saved } = setup(t);
  await store.sync('member', 'room');
  assert.equal(store.peek('member', 'room')?.hasMore, false);
  store.flush();
  assert.deepEqual(saved.at(-1)?.window.messages, []);
  io.latest = async () => [row(1)];
  await store.sync('member', 'room', true);
  assert.deepEqual(ids(store.peek('member', 'room')?.messages), ['m1']);
});

test('failed sync keeps local rows and remains retryable', async (t) => {
  const { store, io } = setup(t, snapshot([row(1)]));
  io.after = async () => { throw Object.assign(new Error('offline'), { status: 403 }); };
  await assert.rejects(store.sync('member', 'room'), /offline/);
  assert.deepEqual(ids(store.peek('member', 'room')?.messages), ['m1']);
  io.after = async () => [row(2)];
  await store.sync('member', 'room');
  assert.deepEqual(ids(store.peek('member', 'room')?.messages), ['m1', 'm2']);
});

test('inactive windows evict by recency while a mounted room stays pinned', async (t) => {
  const { store } = setup(t, snapshot([row(1)]), 2);
  await store.hydrate('member', 'pinned');
  store.subscribe('member', 'pinned', () => {});
  await store.hydrate('member', 'old');
  await store.hydrate('member', 'new');
  assert.ok(store.peek('member', 'pinned'));
  assert.equal(store.peek('member', 'old'), null);
  assert.ok(store.peek('member', 'new'));
});
