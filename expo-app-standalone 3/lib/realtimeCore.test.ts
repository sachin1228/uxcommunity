/**
 * Lifecycle tests for the mobile realtime core.
 *
 * They pin the H-1 mobile findings:
 *
 *  1. RE-CONNECT CATCH-UP — a socket that was down must announce its re-open
 *     (`onRoomStatus`) so the hooks can fetch the gap, and must rebuild the
 *     server's subscription table from local refcounts.
 *  2. RECONNECT RACES — one open in flight at a time, and a replaced socket's
 *     late callbacks can neither deliver events nor schedule another reconnect.
 *  3. LOGOUT CLEANUP — destroy() closes every socket, cancels every reconnect
 *     timer, drops queued frames / subscriptions / presence / identity, and
 *     nothing can recreate a socket afterwards.
 *  4. ACCOUNT SWITCH — User A's realtime state is unreachable from User B's
 *     session, including through User A's stale cleanup closures.
 *  5. USER ROOM — user-scoped rooms multiplex over `user:${userId}`, the exact
 *     DO instance the worker's `resolveRoomTarget`
 *     (apps/realtime/src/room-routing.ts) publishes them to.
 *  6. SUBSCRIBE/UNSUBSCRIBE REPLAY — reconnects restore wanted subscriptions,
 *     never replay a queued unsubscribe, and are harmless when duplicated.
 *
 * The platform (URL builder, socket factory, foreground probe) is faked, so the
 * whole lifecycle runs in Node without React Native.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RealtimeClient,
  isCommunityRoom,
  realtimeRooms,
  userSocketKey,
  type RealtimePlatform,
  type RealtimeSocket,
  type RealtimeTimings,
  type RealtimeUser,
} from './realtimeCore';

// ── Fakes ──────────────────────────────────────────────────────────────────

/** Captured status events for one room, in order. */
type StatusEvent = boolean;

class FakeSocket implements RealtimeSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** True once the client (or the fake) closed this socket. */
  closed = false;

  /** Makes `send()` throw, as a socket that died mid-write does. */
  failSends = false;

  constructor(readonly url: string) {}

  /** Handshake completed. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** The network killed the socket: `close` fires on its own. */
  drop(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('send on a non-open socket');
    if (this.failSends) throw new Error('socket is gone');
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  /** Parsed non-heartbeat frames, in the order they were sent. */
  frames(): Array<Record<string, unknown>> {
    const parsed: Array<Record<string, unknown>> = [];
    for (const raw of this.sent) {
      if (raw === 'ping') continue;
      try {
        parsed.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        /* not a JSON frame */
      }
    }
    return parsed;
  }

  /** Topics this socket asked the server to deliver. */
  subscribedTopics(): string[] {
    return this.frames()
      .filter((frame) => frame.t === 'subscribe')
      .map((frame) => String(frame.topic));
  }

  /** Topics this socket asked the server to stop delivering. */
  unsubscribedTopics(): string[] {
    return this.frames()
      .filter((frame) => frame.t === 'unsubscribe')
      .map((frame) => String(frame.topic));
  }
}

class FakePlatform implements RealtimePlatform {
  sockets: FakeSocket[] = [];
  /** Socket keys the client resolved a URL for, in order. */
  requestedKeys: string[] = [];
  private foregroundHandlers = new Set<() => void>();

  buildSocketUrl = async (socketKey: string): Promise<string> => {
    this.requestedKeys.push(socketKey);
    return `wss://rt.test/ws?room=${encodeURIComponent(socketKey)}&token=test-jwt`;
  };

  createSocket = (url: string): RealtimeSocket => {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    return socket;
  };

  onForeground = (handler: () => void): (() => void) => {
    this.foregroundHandlers.add(handler);
    return () => {
      this.foregroundHandlers.delete(handler);
    };
  };

  /** Simulate the app returning to the foreground. */
  resumeApp(): void {
    for (const handler of [...this.foregroundHandlers]) handler();
  }

  get current(): FakeSocket | undefined {
    return this.sockets[this.sockets.length - 1];
  }
}

const ALICE: RealtimeUser = { id: 'user-a', name: 'Alice', avatar: null };
const BOB: RealtimeUser = { id: 'user-b', name: 'Bob', avatar: null };

/** Short backoff so reconnect tests finish in milliseconds; slow heartbeats. */
const FAST_TIMINGS: RealtimeTimings = {
  reconnectBaseMs: 5,
  reconnectMaxMs: 10,
  heartbeatIntervalMs: 5_000,
  heartbeatTimeoutMs: 5_000,
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function createClient(timings: RealtimeTimings = FAST_TIMINGS): {
  client: RealtimeClient;
  platform: FakePlatform;
} {
  const platform = new FakePlatform();
  return { client: new RealtimeClient(platform, timings), platform };
}

interface ConnectionView {
  key: string;
  ws: FakeSocket | null;
  connected: boolean;
  manuallyClosed: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pending: string[];
  user: RealtimeUser | null;
}

interface RoomView {
  room: string;
  topicRefs: Map<string, number>;
  topicHandlers: Map<string, Set<unknown>>;
  presenceHandlers: Set<unknown>;
  subscribeRefs: number;
}

function internals(client: RealtimeClient): {
  connections: Map<string, ConnectionView>;
  rooms: Map<string, RoomView>;
  presenceCache: Map<string, unknown>;
  user: RealtimeUser | null;
} {
  return client as unknown as {
    connections: Map<string, ConnectionView>;
    rooms: Map<string, RoomView>;
    presenceCache: Map<string, unknown>;
    user: RealtimeUser | null;
  };
}

function connectionKeys(client: RealtimeClient): string[] {
  return [...internals(client).connections.keys()];
}

function connection(client: RealtimeClient, key: string): ConnectionView | undefined {
  return internals(client).connections.get(key);
}

function roomState(client: RealtimeClient, room: string): RoomView | undefined {
  return internals(client).rooms.get(room);
}

/** The socket opened for one socket key, wherever it sits in the list. */
function socketFor(platform: FakePlatform, socketKey: string): FakeSocket {
  const match = platform.sockets.find((candidate) =>
    candidate.url.includes(`room=${encodeURIComponent(socketKey)}`),
  );
  assert.ok(match, `no socket was opened for ${socketKey}`);
  return match;
}

/** Room-status events recorded for one socket key. */
function recorder(): { events: StatusEvent[]; handler: (connected: boolean) => void } {
  const events: StatusEvent[] = [];
  return { events, handler: (connected: boolean) => events.push(connected) };
}

// ══════════════════════════════════════════════════════════════════════════
// A. Reconnect catch-up signalling
// ══════════════════════════════════════════════════════════════════════════

test('a re-opened room announces itself so hooks can catch up on the gap', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('c1');
  const status = recorder();
  const unsubStatus = client.onRoomStatus(room, status.handler);
  const unsubMessage = client.on(room, 'message', () => {});
  const unsubRoom = client.subscribe(room);

  await flush();
  const first = platform.current;
  assert.ok(first, 'a socket is opened for the room');
  first.open();
  await flush();

  assert.deepEqual(
    status.events,
    [true],
    'the first open announces that events start flowing here',
  );

  // Network switch / backgrounded app: the socket dies without the client asking.
  first.drop();
  assert.deepEqual(status.events, [true, false], 'the drop is announced');

  await sleep(20);
  const second = platform.current;
  assert.ok(second);
  assert.notEqual(second, first, 'the client reconnected on its own');
  second.open();
  await flush();

  assert.deepEqual(
    status.events,
    [true, false, true],
    'the re-open is the signal the chat hook turns into a ?after= catch-up',
  );
  assert.deepEqual(
    second.subscribedTopics(),
    ['message'],
    'the re-open replays the subscriptions the refcounts still want',
  );

  unsubStatus();
  unsubMessage();
  unsubRoom();
  client.destroy();
});

test('a released topic stays released across a reconnect', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('c1');
  const unsubMessage = client.on(room, 'message', () => {});
  const unsubEdit = client.on(room, 'message-edit', () => {});
  const unsubRoom = client.subscribe(room);

  await flush();
  platform.current!.open();
  await flush();
  assert.deepEqual(platform.current!.subscribedTopics().sort(), ['message', 'message-edit']);

  // Released while the socket is up: the server hears the unsubscribe.
  unsubEdit();
  assert.deepEqual(platform.current!.unsubscribedTopics(), ['message-edit']);

  platform.current!.drop();
  await sleep(20);
  const reconnected = platform.current!;
  reconnected.open();
  await flush();

  assert.deepEqual(
    reconnected.subscribedTopics(),
    ['message'],
    'only the subscriptions that are still wanted come back',
  );
  assert.equal(
    roomState(client, room)?.topicRefs.has('message-edit'),
    false,
    'the released topic left the local table',
  );

  unsubMessage();
  unsubRoom();
  client.destroy();
});

test('a half-open socket is recycled by the heartbeat and then catches up', async () => {
  // The socket never answers a ping — the case where `readyState` lies about a
  // socket the OS already killed.
  const { client, platform } = createClient({
    reconnectBaseMs: 5,
    reconnectMaxMs: 10,
    heartbeatIntervalMs: 5,
    heartbeatTimeoutMs: 5,
  });
  client.init(ALICE);

  const room = realtimeRooms.chat('c1');
  const status = recorder();
  const unsubStatus = client.onRoomStatus(room, status.handler);
  const unsubMessage = client.on(room, 'message', () => {});
  const unsubRoom = client.subscribe(room);

  await flush();
  const first = platform.current!;
  first.open();
  await flush();

  await sleep(40);
  const second = platform.current;
  assert.ok(second && second !== first, 'the dead socket was replaced');
  second.open();
  await flush();

  assert.deepEqual(status.events, [true, false, true]);
  assert.deepEqual(second.subscribedTopics(), ['message']);

  unsubStatus();
  unsubMessage();
  unsubRoom();
  client.destroy();
});

test('publishes queued while the socket was down are flushed on reconnect', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('c1');
  const unsubTyping = client.on(room, 'typing', () => {});
  const unsubRoom = client.subscribe(room);

  await flush();
  platform.current!.open();
  await flush();

  platform.current!.drop();
  client.publish(room, 'typing', { typing: true, user_id: ALICE.id });
  assert.equal(connection(client, room)?.pending.length, 1, 'the frame waits in the queue');

  await sleep(20);
  const reconnected = platform.current!;
  reconnected.open();
  await flush();

  const published = reconnected.frames().filter((frame) => frame.t === 'publish');
  assert.equal(published.length, 1, 'the queued publish is flushed exactly once');
  assert.equal(connection(client, room)?.pending.length, 0);

  unsubTyping();
  unsubRoom();
  client.destroy();
});

// ══════════════════════════════════════════════════════════════════════════
// B. Reconnect races
// ══════════════════════════════════════════════════════════════════════════

test('a foreground probe racing an open creates one socket, not two', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('c1');
  const unsubRoom = client.subscribe(room);
  const unsubMessage = client.on(room, 'message', () => {});

  await flush();
  // Both paths run before the first open settles.
  client.connect(room);
  platform.resumeApp();
  await flush();

  assert.equal(
    platform.sockets.length,
    1,
    'concurrent triggers share the one open that is already in flight',
  );

  unsubMessage();
  unsubRoom();
  client.destroy();
});

test('late callbacks from a replaced socket cannot touch the current connection', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('c1');
  const received: string[] = [];
  const unsubMessage = client.on(room, 'message', (data) => {
    received.push(String((data as { id?: string }).id));
  });
  const unsubRoom = client.subscribe(room);

  await flush();
  const first = platform.current!;
  const staleOnOpen = first.onopen;
  const staleOnMessage = first.onmessage;
  first.open();
  await flush();

  first.drop();
  await sleep(20);
  const second = platform.current!;
  assert.notEqual(second, first);
  second.open();
  await flush();

  // A socket replaced mid-flight can still be holding the old closures.
  staleOnOpen?.();
  staleOnMessage?.({
    data: JSON.stringify({ t: 'event', room, topic: 'message', data: { id: 'stale' } }),
  });
  assert.deepEqual(received, [], 'a replaced socket delivers nothing');

  const before = platform.sockets.length;
  first.drop();
  await sleep(20);
  assert.equal(
    platform.sockets.length,
    before,
    'and its close cannot schedule a second reconnect for the live socket',
  );

  unsubMessage();
  unsubRoom();
  client.destroy();
});

// ══════════════════════════════════════════════════════════════════════════
// C. Logout cleanup
// ══════════════════════════════════════════════════════════════════════════

test('destroy() closes every socket and cancels every pending reconnect', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const chat = realtimeRooms.chat('c1');
  const notifications = realtimeRooms.notifications(ALICE.id);
  const unsubChat = client.on(chat, 'message', () => {});
  const unsubRoom = client.subscribe(chat);
  const unsubNotifications = client.on(notifications, 'insert', () => {});
  client.onPresence(chat, () => {});

  await flush();
  for (const socket of platform.sockets) socket.open();
  await flush();
  assert.equal(platform.sockets.length, 2, 'one community socket + one user socket');

  // One socket is already down with a reconnect scheduled when logout happens.
  socketFor(platform, chat).drop();
  client.publish(chat, 'typing', { typing: true });
  assert.ok(connection(client, chat)?.reconnectTimer, 'a reconnect is pending');
  assert.equal(connection(client, chat)?.pending.length, 1, 'a frame is queued for the old session');

  client.destroy();

  assert.deepEqual(connectionKeys(client), [], 'no connection survives logout');
  assert.equal(internals(client).rooms.size, 0, 'no subscription survives logout');
  assert.equal(internals(client).presenceCache.size, 0, 'no cached presence survives logout');
  assert.equal(internals(client).user, null, 'the identity is forgotten');
  assert.ok(platform.sockets.every((socket) => socket.closed), 'every socket was closed');
  assert.equal(client.isConnected(), false);

  const socketsAfterLogout = platform.sockets.length;
  await sleep(30);
  assert.equal(
    platform.sockets.length,
    socketsAfterLogout,
    'a cancelled reconnect timer cannot resurrect the old session',
  );

  unsubChat();
  unsubRoom();
  unsubNotifications();
});

test('the previous session’s cleanup closures cannot unwind the new one', () => {
  // Guards the refcount closures: they must read the LIVE room state, not the
  // RoomState object they were created with.
  const { client } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('c1');
  const oldTopic = client.on(room, 'message', () => {});
  const oldRoom = client.subscribe(room);

  client.destroy();

  // The next session wants the same room.
  client.init(BOB);
  const newTopic = client.on(room, 'message', () => {});
  const newRoom = client.subscribe(room);
  assert.equal(roomState(client, room)?.topicRefs.get('message'), 1);

  // The previous session's effect cleanup runs (React unmounts it last).
  oldTopic();
  oldRoom();

  assert.equal(
    roomState(client, room)?.topicRefs.get('message'),
    1,
    "the previous account's cleanup must not release the current subscription",
  );
  assert.equal(roomState(client, room)?.subscribeRefs, 1);

  newTopic();
  newRoom();
  client.destroy();
});

// ══════════════════════════════════════════════════════════════════════════
// D. Account switch
// ══════════════════════════════════════════════════════════════════════════

test('User A logout → User B login leaves no User A realtime state behind', async () => {
  const { client, platform } = createClient();

  // ── User A: subscribe to a community and to their own user room ──
  client.init(ALICE);
  const chat = realtimeRooms.chat('c1');
  const aliceEvents: string[] = [];
  const aliceUnsubChat = client.on(chat, 'message', (data) => {
    aliceEvents.push(String((data as { id?: string }).id));
  });
  const aliceUnsubRoom = client.subscribe(chat);
  const aliceNotifications = realtimeRooms.notifications(ALICE.id);
  const aliceUnsubNotifications = client.on(aliceNotifications, 'insert', () => {});
  client.onPresence(chat, () => {});

  await flush();
  for (const socket of platform.sockets) socket.open();
  await flush();
  assert.deepEqual(connectionKeys(client).sort(), [`user:${ALICE.id}`, chat].sort());

  // ── Logout ──
  const keysAtLogout = platform.requestedKeys.length;
  client.destroy();

  // ── User B signs in ──
  client.init(BOB);
  const bobUnsubChat = client.on(chat, 'message', () => {});
  const bobUnsubRoom = client.subscribe(chat);

  await flush();
  const bobSocket = platform.current!;
  assert.ok(bobSocket !== platform.sockets[0], 'User B gets a fresh socket');
  bobSocket.open();
  await flush();

  const joinFrame = bobSocket.frames().find((frame) => frame.t === 'join');
  assert.deepEqual(
    joinFrame?.user,
    BOB,
    'the new socket introduces User B, never User A',
  );
  assert.deepEqual(
    connectionKeys(client).filter((key) => key.startsWith('user:')),
    [],
    'no user socket is inherited from the previous account',
  );
  assert.equal(
    platform.requestedKeys.some((key) => key === `user:${ALICE.id}`),
    true,
    "User A's own socket key was used while they were signed in",
  );
  assert.deepEqual(
    platform.requestedKeys.slice(keysAtLogout).filter((key) => !key.startsWith('chat:')),
    [],
    "User B's session never resolves a user socket — let alone User A's",
  );
  assert.deepEqual(
    roomState(client, aliceNotifications),
    undefined,
    "User A's user-scoped subscriptions are gone",
  );

  // Events on the new socket reach only the new session's handlers.
  bobSocket.onmessage?.({
    data: JSON.stringify({ t: 'event', room: chat, topic: 'message', data: { id: 'm1' } }),
  });
  assert.deepEqual(aliceEvents, [], "User A's handler never fires in User B's session");

  aliceUnsubChat();
  aliceUnsubRoom();
  aliceUnsubNotifications();
  bobUnsubChat();
  bobUnsubRoom();
  client.destroy();
});

test('init() with a different identity re-keys the user socket and re-joins it', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const notifications = realtimeRooms.notifications(ALICE.id);
  const unsubNotifications = client.on(notifications, 'insert', () => {});

  await flush();
  const aliceSocket = platform.current!;
  aliceSocket.open();
  await flush();
  assert.equal(connectionKeys(client)[0], `user:${ALICE.id}`);

  // A sign-in on top of a live session (an expired cookie never called logout).
  client.init(BOB);

  assert.deepEqual(
    connectionKeys(client),
    [`user:${BOB.id}`],
    'the user socket moves to the new account\'s DO instance',
  );
  assert.ok(aliceSocket.closed, "User A's socket is closed");

  await flush();
  const bobSocket = platform.current!;
  bobSocket.open();
  await flush();

  assert.deepEqual(
    bobSocket.frames().find((frame) => frame.t === 'join')?.user,
    BOB,
    'the replacement socket joins as User B',
  );
  assert.deepEqual(
    bobSocket.subscribedTopics(),
    [],
    "User A's user-scoped room is not replayed onto User B's socket",
  );

  unsubNotifications();
  client.destroy();
});

// ══════════════════════════════════════════════════════════════════════════
// E. User room convention
// ══════════════════════════════════════════════════════════════════════════

test('user-scoped rooms multiplex over user:${userId} — the key the server publishes to', async () => {
  // CONTRACT (pinned on the other side by
  // apps/realtime/__tests__/room-routing.test.ts): the worker resolves
  // `notifications:${userId}` and `profile:${userId}` to the `user:${userId}`
  // DO instance, and the WebSocket upgrade path addresses that instance by the
  // same name. A socket keyed anything else (the old `user:global`) sits in a
  // Durable Object nothing is ever published to.
  assert.equal(userSocketKey('8f14e45f-ceea-467a-9a3c-1b1d3e2f4a5b'), 'user:8f14e45f-ceea-467a-9a3c-1b1d3e2f4a5b');
  assert.equal(userSocketKey(null), 'user:global', 'the placeholder before an identity exists');

  const { client, platform } = createClient();
  client.init(ALICE);

  const unsubNotifications = client.on(realtimeRooms.notifications(ALICE.id), 'insert', () => {});
  const unsubProfile = client.on(`profile:${ALICE.id}`, 'thread', () => {});

  assert.deepEqual(
    connectionKeys(client),
    [`user:${ALICE.id}`],
    'every user-scoped room shares one socket',
  );

  await flush();
  assert.equal(
    platform.requestedKeys[0],
    `user:${ALICE.id}`,
    'the socket URL names the user DO instance the server publishes to',
  );
  assert.equal(platform.sockets.length, 1);

  unsubNotifications();
  unsubProfile();
  client.destroy();
});

test('a user socket opened before sign-in is re-keyed once the identity arrives', async () => {
  const { client, platform } = createClient();

  // A screen (or a push handler) subscribes before `init()` has run.
  const notifications = realtimeRooms.notifications(ALICE.id);
  const unsubNotifications = client.on(notifications, 'insert', () => {});
  await flush();
  assert.deepEqual(connectionKeys(client), ['user:global']);

  client.init(ALICE);

  assert.deepEqual(
    connectionKeys(client),
    [`user:${ALICE.id}`],
    'the placeholder socket is migrated to the real user instance',
  );

  await flush();
  const socket = platform.current!;
  socket.open();
  await flush();

  assert.deepEqual(
    socket.frames().find((frame) => frame.t === 'join')?.user,
    ALICE,
    'the replacement socket joins as the signed-in member',
  );
  assert.deepEqual(
    socket.subscribedTopics(),
    ['insert'],
    'the user-scoped subscription is replayed on the re-keyed socket',
  );

  unsubNotifications();
  client.destroy();
});

test('isCommunityRoom separates community sockets from the user socket', () => {
  assert.equal(isCommunityRoom('chat:c1'), true);
  assert.equal(isCommunityRoom('thread-comments:t1'), true);
  assert.equal(isCommunityRoom(`user:${ALICE.id}`), false);
  assert.equal(isCommunityRoom('notifications:' + ALICE.id), false);
});

// ══════════════════════════════════════════════════════════════════════════
// F. Subscribe / unsubscribe replay
// ══════════════════════════════════════════════════════════════════════════

test('an unsubscribe that could not be sent is never replayed after a reconnect', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('c1');
  const unsubMessage = client.on(room, 'message', () => {});
  const unsubEdit = client.on(room, 'message-edit', () => {});
  const unsubRoom = client.subscribe(room);

  await flush();
  const socket = platform.current!;
  socket.open();
  await flush();
  assert.deepEqual(socket.subscribedTopics().sort(), ['message', 'message-edit']);

  // A half-open socket: `readyState` still says OPEN, the write fails. That is
  // the one way a subscription frame can end up in the queue — and the frame
  // that must never be replayed, because the replayed refcounts are newer.
  socket.failSends = true;
  unsubEdit();
  const queued = connection(client, room)?.pending ?? [];
  assert.equal(queued.length, 1, 'the failed unsubscribe waits in the queue');
  assert.equal((JSON.parse(queued[0]) as { t?: string }).t, 'unsubscribe');

  socket.failSends = false;
  socket.drop();
  await sleep(20);
  const reconnected = platform.current!;
  reconnected.open();
  await flush();

  assert.deepEqual(
    reconnected.subscribedTopics().sort(),
    ['message'],
    'the surviving subscription is restored from the refcounts',
  );
  assert.deepEqual(
    reconnected.unsubscribedTopics(),
    [],
    'the stale unsubscribe is dropped — replaying it could cancel a live subscription',
  );
  assert.equal(connection(client, room)?.pending.length, 0, 'the queue was drained');

  unsubMessage();
  unsubRoom();
  client.destroy();
});

test('a queued subscribe is not replayed on top of the refcount replay', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  // Subscribe before the handshake completes → queued, then replayed on open.
  const room = realtimeRooms.chat('c1');
  const unsubMessage = client.on(room, 'message', () => {});
  const unsubRoom = client.subscribe(room);

  await flush();
  const first = platform.current!;
  assert.equal(first.frames().length, 0, 'nothing is written before the socket opens');
  assert.equal(connection(client, room)?.pending.length, 1, 'the subscribe waits in the queue');

  first.open();
  await flush();
  assert.deepEqual(
    first.subscribedTopics(),
    ['message'],
    'exactly one subscribe frame — the queued copy is not sent on top of the replay',
  );
  assert.equal(connection(client, room)?.pending.length, 0);

  first.drop();
  await sleep(20);
  const reconnected = platform.current!;
  reconnected.open();
  await flush();
  assert.deepEqual(
    reconnected.subscribedTopics(),
    ['message'],
    'reconnect replays each wanted topic exactly once',
  );

  unsubMessage();
  unsubRoom();
  client.destroy();
});

test('duplicate subscribe/unsubscribe frames leave the subscription state deterministic', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('c1');
  const firstHandler = client.on(room, 'message', () => {});
  const secondHandler = client.on(room, 'message', () => {});
  const unsubRoom = client.subscribe(room);

  await flush();
  const socket = platform.current!;
  socket.open();
  await flush();

  assert.deepEqual(
    socket.subscribedTopics(),
    ['message'],
    'two handlers for one topic subscribe once',
  );

  firstHandler();
  assert.deepEqual(socket.unsubscribedTopics(), [], 'one handler leaving keeps the topic');
  assert.equal(roomState(client, room)?.topicRefs.get('message'), 1);

  // Releasing again is idempotent and must not steal the remaining ref.
  firstHandler();
  secondHandler();
  assert.deepEqual(socket.unsubscribedTopics(), ['message'], 'the last handler unsubscribes once');
  assert.equal(roomState(client, room)?.topicRefs.has('message'), false);

  unsubRoom();
  assert.equal(connectionKeys(client).length, 0, 'the room socket is released with its last claim');
  client.destroy();
});

// ══════════════════════════════════════════════════════════════════════════
// Regression guards for the existing lifecycle
// ══════════════════════════════════════════════════════════════════════════

test('one hook releasing a room does not tear down a socket another still holds', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('c1');
  const releaseChat = client.subscribe(room);
  const releaseList = client.subscribe(room);
  const unsubTyping = client.on(room, 'typing', () => {});

  await flush();
  assert.equal(platform.sockets.length, 1);

  unsubTyping();
  releaseChat();
  assert.equal(platform.sockets.length, 1, 'the list still wants the room');

  releaseChat(); // idempotent
  releaseList();
  assert.equal(connectionKeys(client).length, 0, 'the last holder releases the socket');

  client.destroy();
});

test('the foreground probe replaces a dead socket and revives nothing that was released', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('c1');
  const unsubMessage = client.on(room, 'message', () => {});
  const unsubRoom = client.subscribe(room);

  await flush();
  const socket = platform.current!;
  socket.open();
  await flush();

  // `readyState` reports a dead socket without ever firing onclose — the mobile
  // OS case the AppState probe exists for.
  socket.readyState = 3;
  platform.resumeApp();
  await flush();

  assert.equal(platform.sockets.length, 2, 'the probe replaced the dead socket');
  assert.notEqual(
    connection(client, room)?.ws,
    socket,
    'the connection points at the replacement, not the dead socket',
  );

  // After the room is released, a probe has nothing left to revive.
  unsubMessage();
  unsubRoom();
  assert.equal(connectionKeys(client).length, 0);

  platform.resumeApp();
  await flush();
  assert.equal(platform.sockets.length, 2, 'a released room is never reopened');

  client.destroy();
});
