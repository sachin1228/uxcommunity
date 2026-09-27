/**
 * Connection-scaling tests for the mobile realtime client.
 *
 * The production finding this pins: the community list subscribed one WebSocket
 * per joined community, so a member of 30 communities carried 30 sockets — 30
 * heartbeats, 30 reconnect attempts per network change, 30 DO connections.
 *
 * The fix is a socket budget on the client (`realtimeWindow.ts`): only the most
 * recently active communities keep a socket, everything else is covered by the
 * reconcile that already runs on foreground, reconnect and pull-to-refresh. The
 * server cannot carry several communities on one socket (see the module header
 * in `realtimeWindow.ts` and `docs/mobile-architecture.md`), so the honest
 * guarantee is *bounded*, not *shared*: a 100-community member opens exactly as
 * many community sockets as a 10-community member.
 *
 * These tests drive the real `RealtimeClient` against a fake platform, so the
 * socket count they assert is the number of physical `createSocket()` calls:
 *
 *   - the window bounds the community sockets at 1/10/50/100 memberships;
 *   - one screen or five screens on the same community share one socket and one
 *     server subscription (ref-counting);
 *   - releasing a community closes only its socket, and only when the last
 *     consumer releases it;
 *   - a network drop costs one reconnect per live socket — never one per
 *     community, and never two per socket;
 *   - logout/account switch leaves no reachable socket, reconnect timer, or
 *     subscription from the previous session;
 *   - events never cross between communities.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RealtimeClient,
  realtimeRooms,
  userSocketKey,
  type RealtimePlatform,
  type RealtimeSocket,
  type RealtimeTimings,
  type RealtimeUser,
} from './realtimeCore';
import { COMMUNITY_REALTIME_LIMIT, selectLiveCommunityIds } from './realtimeWindow';

// ── Fakes ──────────────────────────────────────────────────────────────────

class FakeSocket implements RealtimeSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

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

  subscribedTopics(): string[] {
    return this.frames()
      .filter((frame) => frame.t === 'subscribe')
      .map((frame) => String(frame.topic));
  }

  unsubscribedTopics(): string[] {
    return this.frames()
      .filter((frame) => frame.t === 'unsubscribe')
      .map((frame) => String(frame.topic));
  }

  /** Deliver one server frame to this socket. */
  deliver(msg: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

class FakePlatform implements RealtimePlatform {
  sockets: FakeSocket[] = [];

  buildSocketUrl = async (socketKey: string): Promise<string> => {
    // Every physical socket this test suite counts is created here.
    return `wss://rt.test/ws?room=${encodeURIComponent(socketKey)}&token=test-jwt`;
  };

  createSocket = (url: string): RealtimeSocket => {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    return socket;
  };

  onForeground = (_handler: () => void): (() => void) => () => {};
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const flush = (): Promise<void> => sleep(1);

function createClient(): { client: RealtimeClient; platform: FakePlatform } {
  const platform = new FakePlatform();
  return { client: new RealtimeClient(platform, FAST_TIMINGS), platform };
}

interface ConnectionView {
  key: string;
  ws: FakeSocket | null;
  connected: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pending: string[];
}

function internals(client: RealtimeClient): {
  connections: Map<string, ConnectionView>;
  rooms: Map<string, { room: string; topicRefs: Map<string, number> }>;
} {
  return client as unknown as {
    connections: Map<string, ConnectionView>;
    rooms: Map<string, { room: string; topicRefs: Map<string, number> }>;
  };
}

function connectionKeys(client: RealtimeClient): string[] {
  return [...internals(client).connections.keys()];
}

/** The `room` query parameter of a socket URL, un-encoded. */
function socketUrlRoom(url: string): string {
  const query = url.slice(url.indexOf('?') + 1);
  return new URLSearchParams(query).get('room') ?? '';
}

/** Every socket ever created for one socket key, in order. */
function socketsFor(platform: FakePlatform, socketKey: string): FakeSocket[] {
  // Compared as an exact parameter, not a substring: `chat:c1` is a prefix of
  // `chat:c10` once URL-encoded, and a scale test is exactly where that lies.
  return platform.sockets.filter((socket) => socketUrlRoom(socket.url) === socketKey);
}

/** Complete the handshake on every socket that is still pending. */
function openSockets(platform: FakePlatform): void {
  for (const socket of platform.sockets) {
    if (socket.readyState === 0) socket.open();
  }
}

function openSocketCount(platform: FakePlatform): number {
  return platform.sockets.filter((socket) => socket.readyState === 1).length;
}

/**
 * Subscribe to a community's chat room exactly like `useCommunities` does:
 * `connect(room)` to open the socket, one `topic` handler, and a status
 * listener for the catch-up edge.
 */
function subscribeCommunity(
  client: RealtimeClient,
  communityId: string,
  received: unknown[] = [],
): { release: () => void; releaseStatus: () => void } {
  const room = realtimeRooms.chat(communityId);
  client.connect(room);
  const releaseStatus = client.onRoomStatus(room, () => {});
  const release = client.on(room, 'message', (data) => received.push(data));
  return { release, releaseStatus };
}

/** Release every consumer of a community's room. */
function releaseCommunity(wanted: { release: () => void; releaseStatus: () => void }): void {
  wanted.release();
  wanted.releaseStatus();
}

// ══════════════════════════════════════════════════════════════════════════
// A. The socket budget
// ══════════════════════════════════════════════════════════════════════════

test('community sockets stay bounded at 1, 10, 50 and 100 memberships', async () => {
  for (const total of [1, 10, 50, 100]) {
    const { client, platform } = createClient();
    client.init(ALICE);

    const ids = Array.from({ length: total }, (_, index) => `community-${index + 1}`);
    const live = selectLiveCommunityIds(ids);
    for (const id of live) subscribeCommunity(client, id);

    await flush();
    openSockets(platform);

    const expected = Math.min(total, COMMUNITY_REALTIME_LIMIT);
    assert.equal(
      connectionKeys(client).length,
      expected,
      `${total} communities must open ${expected} community sockets`,
    );
    assert.equal(
      platform.sockets.length,
      expected,
      `${total} communities must create ${expected} physical sockets`,
    );
    assert.equal(
      openSocketCount(platform),
      expected,
      'every budgeted community socket is actually open',
    );

    client.destroy();
  }

  // The point of the budget: the socket count stops tracking membership count.
  const { client, platform } = createClient();
  client.init(ALICE);
  for (const id of selectLiveCommunityIds(Array.from({ length: 100 }, (_, i) => `c${i}`))) {
    subscribeCommunity(client, id);
  }
  await flush();
  assert.equal(platform.sockets.length, COMMUNITY_REALTIME_LIMIT);
  assert.ok(platform.sockets.length < 100, '100 communities must not mean 100 sockets');
  client.destroy();
});

test('a community outside the window is never opened, and the open chat still gets its own room', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const ids = Array.from({ length: 30 }, (_, index) => `community-${index + 1}`);
  const live = selectLiveCommunityIds(ids);
  for (const id of live) subscribeCommunity(client, id);

  // The screen the user is looking at subscribes its room directly
  // (`useChatMessages`), whether or not the list keeps it live.
  const outsider = ids[25];
  const screen = subscribeCommunity(client, outsider);

  await flush();
  openSockets(platform);

  assert.equal(openSocketCount(platform), COMMUNITY_REALTIME_LIMIT + 1);
  assert.equal(socketsFor(platform, realtimeRooms.chat(outsider)).length, 1);

  // Leaving the screen releases exactly that socket; the list is untouched.
  releaseCommunity(screen);
  assert.equal(socketsFor(platform, realtimeRooms.chat(outsider))[0].closed, true);
  assert.equal(openSocketCount(platform), COMMUNITY_REALTIME_LIMIT);
  for (const id of live) {
    assert.equal(socketsFor(platform, realtimeRooms.chat(id))[0].closed, false);
  }

  client.destroy();
});

// ══════════════════════════════════════════════════════════════════════════
// B. Ref-counting — many screens, one socket, one server subscription
// ══════════════════════════════════════════════════════════════════════════

test('two screens on the same community share one socket and one subscribe frame', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('community-1');
  const received: unknown[] = [];
  const screenA = subscribeCommunity(client, 'community-1', received);
  const screenB = subscribeCommunity(client, 'community-1', received);

  await flush();
  openSockets(platform);

  assert.deepEqual(connectionKeys(client), [room]);
  assert.equal(socketsFor(platform, room).length, 1, 'one physical socket for both screens');
  assert.deepEqual(
    socketsFor(platform, room)[0].subscribedTopics(),
    ['message'],
    'the second screen must not send a duplicate subscribe frame',
  );

  // Releasing one screen must not tear the socket down or unsubscribe the other.
  screenA.release();
  assert.equal(socketsFor(platform, room)[0].closed, false);
  assert.deepEqual(socketsFor(platform, room)[0].unsubscribedTopics(), []);
  assert.equal(internals(client).rooms.get(room)?.topicRefs.get('message'), 1);

  // Last consumer leaves — now the server is told, and the socket closes.
  screenB.release();
  assert.deepEqual(socketsFor(platform, room)[0].unsubscribedTopics(), ['message']);
  screenB.releaseStatus();
  assert.equal(socketsFor(platform, room)[0].closed, true);
  assert.deepEqual(connectionKeys(client), []);

  client.destroy();
});

test('unsubscribing one community leaves the others open and subscribed', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const a = subscribeCommunity(client, 'a');
  const b = subscribeCommunity(client, 'b');
  const c = subscribeCommunity(client, 'c');

  await flush();
  openSockets(platform);
  assert.equal(openSocketCount(platform), 3);

  releaseCommunity(a);

  assert.equal(socketsFor(platform, realtimeRooms.chat('a'))[0].closed, true);
  assert.deepEqual(connectionKeys(client), [realtimeRooms.chat('b'), realtimeRooms.chat('c')]);
  for (const id of ['b', 'c']) {
    const socket = socketsFor(platform, realtimeRooms.chat(id))[0];
    assert.equal(socket.closed, false, `${id} must stay open`);
    assert.deepEqual(socket.subscribedTopics(), ['message']);
  }

  releaseCommunity(b);
  assert.equal(socketsFor(platform, realtimeRooms.chat('b'))[0].closed, true);
  assert.equal(socketsFor(platform, realtimeRooms.chat('c'))[0].closed, false);

  releaseCommunity(c);
  assert.equal(socketsFor(platform, realtimeRooms.chat('c'))[0].closed, true);
  assert.deepEqual(connectionKeys(client), []);

  client.destroy();
});

test('releasing every consumer before the socket opens leaves no socket and no queued frame', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const wanted = ['a', 'b', 'c', 'd', 'e'].map((id) => subscribeCommunity(client, id));
  for (const consumers of wanted) releaseCommunity(consumers);

  await flush();

  assert.deepEqual(connectionKeys(client), []);
  assert.equal(platform.sockets.length, 0, 'a released room must not leave a socket behind');

  client.destroy();
});

// ══════════════════════════════════════════════════════════════════════════
// C. Reconnect — one attempt per live socket, subscriptions restored
// ══════════════════════════════════════════════════════════════════════════

test('a network drop reconnects each live community once and restores its subscriptions', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const ids = Array.from({ length: COMMUNITY_REALTIME_LIMIT }, (_, i) => `community-${i + 1}`);
  for (const id of ids) subscribeCommunity(client, id);
  await flush();
  openSockets(platform);

  // Every socket dies at once, as a Wi-Fi → LTE switch does.
  for (const socket of platform.sockets) socket.drop();

  const connections = internals(client).connections;
  assert.equal(connections.size, COMMUNITY_REALTIME_LIMIT);
  for (const [key, conn] of connections) {
    assert.notEqual(conn.reconnectTimer, null, `${key} must schedule exactly one reconnect`);
  }

  await sleep(40);
  openSockets(platform);

  for (const id of ids) {
    const room = realtimeRooms.chat(id);
    const sockets = socketsFor(platform, room);
    assert.equal(sockets.length, 2, `${room} must open exactly one replacement socket`);
    assert.equal(sockets[0].closed, true);
    assert.equal(sockets[1].readyState, 1, `${room} must be back up`);
    assert.deepEqual(
      sockets[1].subscribedTopics(),
      ['message'],
      `${room} must replay its subscription exactly once`,
    );
  }
  for (const [key, conn] of connections) {
    assert.equal(conn.reconnectTimer, null, `${key} must not keep a timer after reconnecting`);
    assert.equal(conn.reconnectAttempt, 0, `${key} must reset its backoff`);
  }

  client.destroy();
});

test('20 communities hit by one network failure produce 10 reconnects, not 20', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const ids = Array.from({ length: 20 }, (_, i) => `community-${i + 1}`);
  for (const id of selectLiveCommunityIds(ids)) subscribeCommunity(client, id);
  await flush();
  openSockets(platform);

  const before = platform.sockets.length;
  assert.equal(before, COMMUNITY_REALTIME_LIMIT);

  for (const socket of platform.sockets) socket.drop();
  await sleep(40);
  openSockets(platform);

  assert.equal(
    platform.sockets.length,
    before * 2,
    'one network failure must cost one reconnect per live socket, not one per community',
  );
  assert.equal(openSocketCount(platform), COMMUNITY_REALTIME_LIMIT);

  client.destroy();
});

test('a re-open announces itself so the surface can catch up on the gap', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('a');
  const events: boolean[] = [];
  client.connect(room);
  client.onRoomStatus(room, (connected) => events.push(connected));
  const release = client.on(room, 'message', () => {});

  await flush();
  openSockets(platform);
  assert.deepEqual(events, [true]);

  platform.sockets[0].drop();
  assert.deepEqual(events, [true, false]);

  await sleep(40);
  openSockets(platform);
  assert.deepEqual(events, [true, false, true], 'the hook catches up once per re-open');
  assert.equal(socketsFor(platform, room)[0].unsubscribedTopics().length, 0);

  release();
  client.destroy();
});

test('a replaced socket cannot deliver a late frame a second time', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const room = realtimeRooms.chat('a');
  const received: unknown[] = [];
  client.connect(room);
  const release = client.on(room, 'message', (data) => received.push(data));

  await flush();
  openSockets(platform);
  const original = socketsFor(platform, room)[0];
  original.drop();
  await sleep(40);
  openSockets(platform);

  const replacement = socketsFor(platform, room)[1];
  replacement.deliver({ t: 'event', room, topic: 'message', data: { id: 'm1' } });
  assert.deepEqual(received, [{ id: 'm1' }]);

  // The dead socket is no longer the connection's socket, so a late frame from
  // it is ignored (`conn.ws !== ws`) instead of reaching the room a second time.
  original.readyState = 1;
  original.deliver({ t: 'event', room, topic: 'message', data: { id: 'late' } });
  assert.deepEqual(received, [{ id: 'm1' }], 'a replaced socket cannot deliver again');

  release();
  client.destroy();
});

// ══════════════════════════════════════════════════════════════════════════
// D. Isolation between communities
// ══════════════════════════════════════════════════════════════════════════

test('a message from community A reaches only A listeners', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const receivedA: unknown[] = [];
  const receivedB: unknown[] = [];
  const a = subscribeCommunity(client, 'a', receivedA);
  const b = subscribeCommunity(client, 'b', receivedB);

  await flush();
  openSockets(platform);

  socketsFor(platform, realtimeRooms.chat('a'))[0].deliver({
    t: 'event',
    room: realtimeRooms.chat('a'),
    topic: 'message',
    data: { id: 'from-a' },
  });
  assert.deepEqual(receivedA, [{ id: 'from-a' }]);
  assert.deepEqual(receivedB, []);

  socketsFor(platform, realtimeRooms.chat('b'))[0].deliver({
    t: 'event',
    room: realtimeRooms.chat('b'),
    topic: 'message',
    data: { id: 'from-b' },
  });
  assert.deepEqual(receivedA, [{ id: 'from-a' }]);
  assert.deepEqual(receivedB, [{ id: 'from-b' }]);

  a.release();
  b.release();
  client.destroy();
});

// ══════════════════════════════════════════════════════════════════════════
// E. Logout, account switch and the user socket
// ══════════════════════════════════════════════════════════════════════════

test('logout closes every socket in the window and stops creating new ones', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  for (const id of selectLiveCommunityIds(Array.from({ length: 50 }, (_, i) => `c${i}`))) {
    subscribeCommunity(client, id);
  }
  const notifications = realtimeRooms.notifications(ALICE.id);
  client.on(notifications, 'insert', () => {});

  await flush();
  openSockets(platform);
  assert.equal(platform.sockets.length, COMMUNITY_REALTIME_LIMIT + 1);

  client.destroy();

  assert.equal(internals(client).connections.size, 0);
  assert.equal(internals(client).rooms.size, 0);
  assert.ok(platform.sockets.every((socket) => socket.closed));
  await sleep(20);
  assert.equal(platform.sockets.length, COMMUNITY_REALTIME_LIMIT + 1, 'nothing reopens after logout');
});

test('user-scoped rooms share one socket, keyed by the signed-in user', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const notifications = realtimeRooms.notifications(ALICE.id);
  const profile = `profile:${ALICE.id}`;
  client.on(notifications, 'insert', () => {});
  client.on(profile, 'update', () => {});

  await flush();
  openSockets(platform);

  const key = userSocketKey(ALICE.id);
  assert.deepEqual(connectionKeys(client), [key]);
  assert.equal(platform.sockets.length, 1, 'both user rooms multiplex over one socket');
  const socket = socketsFor(platform, key)[0];
  assert.deepEqual(
    socket.frames()
      .filter((frame) => frame.t === 'subscribe')
      .map((frame) => frame.room),
    [notifications, profile],
  );
  assert.deepEqual(socket.subscribedTopics().sort(), ['insert', 'update']);

  client.destroy();
});

test('User A → logout → User B leaves none of A’s rooms or sockets reachable', async () => {
  const { client, platform } = createClient();
  client.init(ALICE);

  const alice = ['a1', 'a2', 'a3'].map((id) => subscribeCommunity(client, id));
  const aliceNotifications = client.on(realtimeRooms.notifications(ALICE.id), 'insert', () => {});
  await flush();
  openSockets(platform);
  const aliceSockets = [...platform.sockets];

  // A cleanup closure captured before the logout must be inert afterwards.
  const staleRelease = alice[0].release;

  client.destroy();

  client.init(BOB);
  const bob = subscribeCommunity(client, 'b1');
  const bobNotifications = client.on(realtimeRooms.notifications(BOB.id), 'insert', () => {});
  await flush();
  openSockets(platform);

  assert.deepEqual(connectionKeys(client), [realtimeRooms.chat('b1'), userSocketKey(BOB.id)]);
  assert.ok(aliceSockets.every((socket) => socket.closed), 'A’s sockets are all closed');
  assert.equal(
    socketsFor(platform, userSocketKey(ALICE.id)).length,
    1,
    'A’s user socket is not reopened for B',
  );

  // The stale closure runs against the new session but changes nothing.
  staleRelease();
  assert.equal(internals(client).rooms.get(realtimeRooms.chat('b1'))?.topicRefs.get('message'), 1);
  assert.equal(socketsFor(platform, realtimeRooms.chat('b1'))[0].closed, false);
  assert.deepEqual(connectionKeys(client), [realtimeRooms.chat('b1'), userSocketKey(BOB.id)]);

  bob.release();
  bobNotifications();
  aliceNotifications();
  client.destroy();
});
