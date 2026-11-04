import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let createStore;
let moduleId = 0;
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'mobile-chat-tests-'));
after(() => rm(temporary, { recursive: true, force: true }));
async function bundle(entry, plugins = []) {
  const result = await build({ entryPoints: [root + entry], bundle: true, write: false,
    platform: 'node', format: 'esm', plugins });
  const output = join(temporary, `bundle-${moduleId++}.mjs`);
  await writeFile(output, result.outputFiles[0].text);
  return import(pathToFileURL(output).href);
}
before(async () => {
  ({ createCommunityMessageStore: createStore } = await bundle('lib/communityMessageStore.ts'));
});
const NOW = Date.parse('2026-11-04T12:00:00Z');
function message(id, content = id) {
  return { id, content, user_id: 'sender', created_at: new Date(NOW - 1_000).toISOString(),
    image_url: null, reply_to_id: null, deleted_at: null, users: null, reactions: [], reply_to: null };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function setup(t, { disk = null, latest = async () => [], after = async () => [] } = {}) {
  const listeners = new Map();
  const statuses = [];
  const requests = [];
  const store = createStore({
    now: () => NOW, writeDelayMs: 60_000,
    load: async () => disk, save: async () => {},
    fetchLatest: (room) => { requests.push(`latest:${room}`); return latest(room); },
    fetchAfter: (room, cursor) => { requests.push(`after:${room}:${cursor.id}`); return after(room, cursor); },
  });
  store.activateUser('member');
  const harness = globalThis.mobileChatHarness = {
    store, user: { id: 'member', name: 'Member' },
    history: async () => [],
    realtime: {
      init() {}, connect() {}, subscribe: () => () => {},
      on(room, topic, callback) {
        const key = `${room}:${topic}`;
        listeners.set(key, callback);
        return () => listeners.delete(key);
      },
      onRoomStatus(_room, callback) { statuses.push(callback); return () => {}; },
    },
  };
  const mocks = {
    'react-native': 'export const AppState = { addEventListener: () => ({ remove() {} }) };',
    '@/context/AuthContext': 'export const useAuth = () => globalThis.mobileChatHarness;',
    '@/lib/realtime': `export const realtimeClient = globalThis.mobileChatHarness.realtime;
      export const realtimeRooms = { chat: id => 'chat:' + id };`,
    '@/lib/communities': `export const getMessages = (...args) => globalThis.mobileChatHarness.history(...args);
      export const markRead = async () => {};`,
    '@/lib/readManager': 'export const scheduleMarkRead = () => {};',
    '@/lib/communityMessageStoreRuntime': 'export const communityMessageStore = globalThis.mobileChatHarness.store;',
    // A network image which never loads must not hold history off screen.
    '@/lib/chatMediaPrefetch': 'export const warmChatMedia = () => new Promise(() => {});',
  };
  const { useChatMessages } = await bundle('hooks/useChatMessages.ts', [{ name: 'native-boundary', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: require.resolve('react'), external: true }));
    builder.onResolve({ filter: /^(react-native|@\/)/ }, ({ path }) => path in mocks
      ? { path, namespace: 'controlled-native' }
      : { path: root + path.replace('@/', '') + '.ts' });
    builder.onLoad({ filter: /.*/, namespace: 'controlled-native' }, ({ path }) => ({ contents: mocks[path] }));
  } }]);
  let hook;
  let view;
  const renders = [];
  function Probe({ room = 'room' }) {
    hook = useChatMessages(room);
    renders.push({ loading: hook.isLoading, ids: hook.messages.map((row) => row.id) });
    return React.createElement('chat', { loading: hook.isLoading }, hook.messages.map((row) => row.content).join('|'));
  }
  t.after(async () => { if (view) await act(async () => view.unmount()); store.activateUser(null); });
  return {
    store, harness, requests, renders,
    get hook() { return hook; },
    mount: async () => { await act(async () => { view = create(React.createElement(Probe)); }); },
    switchRoom: async (room) => { await act(async () => view.update(React.createElement(Probe, { room }))); },
    event: async (topic, row) => { await act(async () => { listeners.get(`chat:room:${topic}`)?.(row); }); },
  };
}

test('a warm chat has messages and no loading state on its very first render', async (t) => {
  const stalled = deferred();
  const h = await setup(t, { disk: { messages: [message('m1')], syncedThrough: { ts: message('m1').created_at, id: 'm1' } }, after: () => stalled.promise });
  await h.store.hydrate('member', 'room');
  await h.mount();
  assert.deepEqual(h.renders[0], { loading: false, ids: ['m1'] });
  assert.deepEqual(h.requests, ['after:room:m1']);
  assert.equal(h.hook.isLoading, false);
  assert.equal(h.hook.hasMore, false, 'a short cached window must not trigger a redundant history fetch');
  await act(async () => stalled.resolve([message('m2')]));
  assert.deepEqual(h.hook.messages.map((row) => row.id), ['m1', 'm2']);
});

test('cold disk rows become visible while catch-up remains pending', async (t) => {
  const stalled = deferred();
  const h = await setup(t, { disk: { messages: [message('m1')], syncedThrough: { ts: message('m1').created_at, id: 'm1' } }, after: () => stalled.promise });
  await h.mount();
  assert.deepEqual(h.hook.messages.map((row) => row.id), ['m1']);
  assert.equal(h.hook.isLoading, false);
  assert.deepEqual(h.requests, ['after:room:m1']);
  await act(async () => stalled.resolve([]));
});

test('a cache miss displays the first message page without optional data or image warming', async (t) => {
  const h = await setup(t, { latest: async () => [message('m1')] });
  await h.mount();
  assert.equal(h.hook.isLoading, false);
  assert.deepEqual(h.hook.messages.map((row) => row.id), ['m1']);
  assert.deepEqual(h.requests, ['latest:room']);
});

test('switching rooms clears the outgoing messages before rendering the destination', async (t) => {
  const stalled = deferred();
  const h = await setup(t, { latest: async (room) => room === 'room' ? [message('m1')] : stalled.promise });
  await h.mount();
  await h.switchRoom('other');
  assert.deepEqual(h.hook.messages, []);
  await act(async () => stalled.resolve([message('other-message')]));
  assert.deepEqual(h.hook.messages.map((row) => row.id), ['other-message']);
});

test('optimistic image confirmation retains its local preview without duplicating the bubble', async (t) => {
  const h = await setup(t);
  await h.mount();
  await act(async () => h.hook.appendMessage({ ...message('temp-send', ''), user_id: 'member', image_url: 'file://preview.jpg', status: 'sending' }));
  await h.event('message', { ...message('server-send', ''), user_id: 'member', community_id: 'room', image_url: 'https://cdn.invalid/image.jpg' });
  await act(async () => h.store.remember('member', 'room', [{ ...message('server-send', ''), user_id: 'member', image_url: 'https://cdn.invalid/image.jpg' }]));
  assert.equal(h.hook.messages.length, 1);
  assert.equal(h.hook.messages[0].id, 'server-send');
  assert.equal(h.hook.messages[0].image_url, 'file://preview.jpg');
});

test('history pagination commits without waiting for images to load', async (t) => {
  const h = await setup(t, { latest: async () => Array.from({ length: 50 }, (_, index) => message(`m${index + 1}`)) });
  await h.mount();
  h.harness.history = async () => [message('older')];
  await act(async () => h.hook.loadMore());
  assert.ok(h.hook.messages.some((row) => row.id === 'older'));
  assert.equal(h.hook.isLoadingMore, false);
});

test('a previously confirmed empty chat does not return to loading while syncing', async (t) => {
  const h = await setup(t);
  await h.store.sync('member', 'room');
  await h.mount();
  assert.deepEqual(h.renders[0], { loading: false, ids: [] });
});

async function runtime(t, disk = null) {
  const saved = [];
  const reads = [];
  globalThis.mobileCacheBoundary = {
    chatCache: { loadCommunityWindow: async () => disk, saveCommunityWindow: async (...args) => { saved.push(args); } },
    getMessages: async (...args) => { reads.push(args); return [message('api-message')]; },
  };
  const mocks = {
    './chatCacheStore': 'export const chatCache = globalThis.mobileCacheBoundary.chatCache;',
    './communities': 'export const getMessages = (...args) => globalThis.mobileCacheBoundary.getMessages(...args);',
    './chatMediaPrefetch': 'export const warmChatMedia = () => globalThis.mobileCacheBoundary.warmMedia?.() ?? new Promise(() => {});',
  };
  const module = await bundle('lib/communityMessageStoreRuntime.ts', [{ name: 'runtime-native-boundary', setup(builder) {
    builder.onResolve({ filter: /^\.\// }, ({ path, importer }) => importer.endsWith('communityMessageStoreRuntime.ts') && path in mocks
      ? { path, namespace: 'runtime-native' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'runtime-native' }, ({ path }) => ({ contents: mocks[path] }));
  } }]);
  module.communityMessageStore.activateUser('member');
  t.after(() => module.communityMessageStore.activateUser(null));
  return { ...module, saved, reads };
}

test('the actual runtime caches a closed chat live event and persists its recovery checkpoint', async (t) => {
  const old = { ...message('old'), created_at: new Date().toISOString() };
  const h = await runtime(t, { messages: [old], syncedThrough: { ts: old.created_at, id: old.id } });
  h.cacheCommunityMessageEvent('member', 'chat:room', 'message', {
    ...old, id: 'new', community_id: 'room', sender_name: 'Sender', sender_avatar_url: null,
  });
  await h.communityMessageStore.hydrate('member', 'room');
  const state = h.communityMessageStore.peek('member', 'room');
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages.find((row) => row.id === 'new').users.name, 'Sender');
  assert.equal(state.syncedThrough.id, 'old');
  h.communityMessageStore.flush();
  assert.equal(h.saved[0][2].syncedThrough.id, 'old');
  assert.equal(h.reads.length, 0, 'a live payload does not need another HTTP fetch');
});

test('runtime sync commits a message-only read while image warming never resolves', async (t) => {
  const h = await runtime(t);
  globalThis.mobileCacheBoundary.getMessages = async (...args) => {
    h.reads.push(args);
    return [{ ...message('latest'), created_at: new Date().toISOString() }];
  };
  await h.communityMessageStore.sync('member', 'room');
  assert.equal(h.communityMessageStore.peek('member', 'room').messages[0].id, 'latest');
  assert.deepEqual(h.reads, [['room', undefined, undefined]]);
});

test('a rejected media prefetch cannot fail message loading or leak an unhandled rejection', async (t) => {
  const h = await runtime(t);
  globalThis.mobileCacheBoundary.warmMedia = async () => { throw new Error('image unavailable'); };
  globalThis.mobileCacheBoundary.getMessages = async () => [{ ...message('latest'), created_at: new Date().toISOString() }];
  await h.communityMessageStore.sync('member', 'room');
  assert.equal(h.communityMessageStore.peek('member', 'room').messages[0].id, 'latest');
});

test('closed-chat edits, deletions and reactions update the window without a screen listener', async (t) => {
  const old = { ...message('m1'), created_at: new Date().toISOString() };
  const h = await runtime(t, { messages: [old], syncedThrough: { ts: old.created_at, id: old.id } });
  await h.communityMessageStore.hydrate('member', 'room');
  h.cacheCommunityMessageEvent('member', 'chat:room', 'message-edit', { id: 'm1', content: 'edited', edited_at: old.created_at });
  h.cacheCommunityMessageEvent('member', 'chat:room', 'reaction-insert', { message_id: 'm1', emoji: '👍', user_id: 'other' });
  assert.equal(h.communityMessageStore.peek('member', 'room').messages[0].content, 'edited');
  assert.deepEqual(h.communityMessageStore.peek('member', 'room').messages[0].reactions, [{ emoji: '👍', user_ids: ['other'] }]);
  h.cacheCommunityMessageEvent('member', 'chat:room', 'message-delete', { id: 'm1', deleted_at: old.created_at });
  assert.equal(h.communityMessageStore.peek('member', 'room').messages[0].content, null);
  assert.deepEqual(h.communityMessageStore.peek('member', 'room').messages[0].reactions, []);
});

test('runtime rejects foreign accounts, mismatched rooms and malformed message events', async (t) => {
  const h = await runtime(t);
  const row = { ...message('m1'), created_at: new Date().toISOString(), community_id: 'room' };
  h.cacheCommunityMessageEvent('other', 'chat:room', 'message', row);
  h.cacheCommunityMessageEvent('member', 'chat:other-room', 'message', row);
  h.cacheCommunityMessageEvent('member', 'chat:room', 'message', { id: 'malformed' });
  assert.equal(h.communityMessageStore.peek('member', 'room'), null);
  assert.equal(h.reads.length, 0);
});

test('a notification snapshot displays its message before the API is reachable', async (t) => {
  const h = await runtime(t);
  const row = { ...message('notified-message'), created_at: new Date().toISOString(), community_id: 'room', sender_name: 'Sender' };
  h.cacheCommunityPushSnapshot('member', { communityId: 'room', messageId: row.id, recipientId: 'member', chatMessage: JSON.stringify(row) });
  assert.equal(h.communityMessageStore.peek('member', 'room').messages[0].content, row.content);
  assert.equal(h.communityMessageStore.peek('member', 'room').syncedThrough, null);
  assert.equal(h.reads.length, 0);
  await h.communityMessageStore.hydrate('member', 'room');
});
