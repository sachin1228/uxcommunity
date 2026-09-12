import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

/**
 * Isolation tests for RealtimeClient — proves:
 *
 * 1. Two RealtimeClient instances (simulating two browser tabs) have
 *    separate connections maps, so the user-scoped socket is instance-local.
 *
 * 2. Closing one community connection does not affect other community
 *    connections or the user-scoped socket on the same instance.
 *
 * 3. User A's user-scoped events cannot reach User B's instance.
 *
 * CONTRACT (the server depends on this):
 * - There is exactly ONE user-scoped socket per browser, keyed `user:${userId}`,
 *   carrying every user-scoped room (notifications:*, profile:*,
 *   designers-studio) as subscribe frames.
 * - apps/realtime/src/index.ts resolveRoomTarget() publishes user-scoped rooms
 *   to that same `user:${userId}` DO instance. If this key and the server's
 *   target ever disagree, those publishes land in a Durable Object with no
 *   sockets and are silently dropped.
 *
 * FINDINGS:
 * - The user-scoped socket is never removed by maybeRemoveConnection (by
 *   design: it persists for the tab lifetime).
 * - init() with a different identity re-keys the socket to that user's DO, so
 *   a login or user switch cannot leave the browser on a stale instance.
 *
 * NOTE: These tests instantiate RealtimeClient directly (not the exported
 * singleton) to simulate two browser tabs.
 */

import { realtimeClient } from "./client";

const RealtimeClientClass = (realtimeClient as any).constructor as new () => typeof realtimeClient;

// ── Helpers ────────────────────────────────────────────────────────────────

function getConnectionKeys(client: any): string[] {
  return [...(client.connections as Map<string, unknown>).keys()];
}

function getConnectionCount(client: any): number {
  return (client.connections as Map<string, unknown>).size;
}

function getUserOnConnection(client: any, key: string): unknown {
  const conn = (client.connections as Map<string, any>).get(key);
  return conn?.user ?? null;
}

function isManuallyClosed(client: any, key: string): boolean {
  const conn = (client.connections as Map<string, any>).get(key);
  return conn?.manuallyClosed === true;
}

/** Key of the single user-scoped socket — mirrors RealtimeClient.userConnectionKey(). */
function userKey(client: any): string {
  return client.user ? `user:${client.user.id}` : "user:global";
}

// ── Cleanup ────────────────────────────────────────────────────────────────

let clientA: any;
let clientB: any;

beforeEach(() => {
  clientA = new RealtimeClientClass();
  clientB = new RealtimeClientClass();
});

afterEach(() => {
  try { clientA?.destroy(); } catch {}
  try { clientB?.destroy(); } catch {}
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 1: "user:global" is scoped to the individual RealtimeClient instance
// ══════════════════════════════════════════════════════════════════════════

test("user-scoped socket is keyed per user and is instance-local", () => {
  clientA.init({ id: "user-a", name: "Alice", avatar: null });
  clientB.init({ id: "user-b", name: "Bob", avatar: null });

  const unsubA = clientA.on("notifications:user-a", "updates", () => {});
  const unsubB = clientB.on("notifications:user-b", "updates", () => {});

  const keysA = getConnectionKeys(clientA);
  const keysB = getConnectionKeys(clientB);

  assert.deepStrictEqual(keysA, ["user:user-a"]);
  assert.deepStrictEqual(keysB, ["user:user-b"]);

  assert.notStrictEqual(
    (clientA as any).connections,
    (clientB as any).connections,
    "connections maps must be different instances",
  );

  unsubA();
  unsubB();
});

test("two instances' user-scoped connections are independent", () => {
  clientA.init({ id: "user-a", name: "Alice", avatar: null });
  clientB.init({ id: "user-b", name: "Bob", avatar: null });

  const unsubA = clientA.on("notifications:user-a", "updates", () => {});
  const unsubB = clientB.on("notifications:user-b", "updates", () => {});

  assert.strictEqual(getConnectionCount(clientA), 1);
  assert.strictEqual(getConnectionCount(clientB), 1);

  clientA.destroy();

  assert.strictEqual(getConnectionCount(clientA), 0);
  assert.strictEqual(getConnectionCount(clientB), 1,
    "destroying clientA must not affect clientB");

  unsubA();
  unsubB();
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 2: init() identity handling
// ══════════════════════════════════════════════════════════════════════════

test("init() before on() persists the user onto connections created later", () => {
  clientA.init({ id: "user-a", name: "Alice", avatar: null });

  // on() creates the connection AFTER init()
  const unsub = clientA.on("notifications:user-a", "updates", () => {});

  assert.deepStrictEqual(
    getUserOnConnection(clientA, userKey(clientA)),
    { id: "user-a", name: "Alice", avatar: null },
    "connections created after init() must carry the user so they send `join`",
  );

  unsub();
});

test("init() with a different identity re-keys the user socket to that user's DO", () => {
  clientA.init({ id: "user-a", name: "Alice", avatar: null });
  const unsub = clientA.on("notifications:user-a", "updates", () => {});

  assert.deepStrictEqual(getConnectionKeys(clientA), ["user:user-a"]);

  // A different identity must MOVE the socket: the server only publishes
  // user-scoped rooms to `user:${userId}`, so staying on user-a would drop
  // every event meant for user-c.
  clientA.init({ id: "user-c", name: "Charlie", avatar: null });

  assert.deepStrictEqual(getConnectionKeys(clientA), ["user:user-c"]);
  assert.deepStrictEqual(
    getUserOnConnection(clientA, "user:user-c"),
    { id: "user-c", name: "Charlie", avatar: null },
    "the re-keyed connection carries the new identity so it sends `join`",
  );

  unsub();
});

test("init() after on() re-keys the placeholder socket and attaches identity", () => {
  // Connection created before any identity exists
  const unsub = clientA.on("notifications:user-a", "updates", () => {});
  assert.deepStrictEqual(getConnectionKeys(clientA), ["user:global"]);

  clientA.init({ id: "user-a", name: "Alice", avatar: null });

  assert.deepStrictEqual(getConnectionKeys(clientA), ["user:user-a"]);
  assert.deepStrictEqual(
    getUserOnConnection(clientA, "user:user-a"),
    { id: "user-a", name: "Alice", avatar: null },
    "identity lands on the re-keyed connection",
  );

  unsub();
});

test("every user-scoped room multiplexes over ONE socket to the user's DO", () => {
  clientA.init({ id: "user-a", name: "Alice", avatar: null });

  const unsubNotif = clientA.on("notifications:user-a", "insert", () => {});
  const unsubProfile = clientA.on("profile:user-a", "thread", () => {});
  const unsubDesigners = clientA.on("designers-studio", "presence", () => {});

  assert.deepStrictEqual(getConnectionKeys(clientA), ["user:user-a"],
    "three user-scoped rooms must share a single socket — one socket per room would miss the DO the server publishes to");

  unsubNotif();
  unsubProfile();
  unsubDesigners();
});

test("destroy() clears all connections, allowing fresh init with new user", () => {
  clientA.init({ id: "user-a", name: "Alice", avatar: null });
  const unsub = clientA.on("notifications:user-a", "updates", () => {});

  assert.strictEqual(getConnectionCount(clientA), 1);

  clientA.destroy();
  assert.strictEqual(getConnectionCount(clientA), 0);

  // Re-init with different user — fresh connection carries the new identity
  clientA.init({ id: "user-b", name: "Bob", avatar: null });
  const unsub2 = clientA.on("notifications:user-b", "updates", () => {});

  assert.strictEqual(getConnectionCount(clientA), 1);
  assert.deepStrictEqual(
    getUserOnConnection(clientA, userKey(clientA)),
    { id: "user-b", name: "Bob", avatar: null },
    "fresh connection after destroy() uses the latest init() identity",
  );

  unsub();
  unsub2();
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 3: Community connections are isolated
// ══════════════════════════════════════════════════════════════════════════

test("community connections are keyed by room name, not user:global", () => {
  const unsubCommA = clientA.on("chat:community-a", "chat", () => {});
  const unsubCommB = clientA.on("chat:community-b", "chat", () => {});

  const keys = getConnectionKeys(clientA).sort();
  assert.deepStrictEqual(keys, ["chat:community-a", "chat:community-b"]);

  unsubCommA();
  unsubCommB();
});

test("closing community A does not affect community B or the user socket", () => {
  const unsubCommA = clientA.on("chat:community-a", "chat", () => {});
  const unsubCommB = clientA.on("chat:community-b", "chat", () => {});
  const unsubNotif = clientA.on("notifications:user-a", "updates", () => {});

  assert.strictEqual(getConnectionCount(clientA), 3);

  unsubCommA();

  const keysAfter = getConnectionKeys(clientA).sort();
  assert.deepStrictEqual(keysAfter, ["chat:community-b", userKey(clientA)].sort());
  assert.strictEqual(getConnectionCount(clientA), 2);

  unsubCommB();
  unsubNotif();
});

test("FINDING: the user socket is never removed by maybeRemoveConnection", () => {
  const unsubNotif = clientA.on("notifications:user-a", "updates", () => {});
  assert.strictEqual(getConnectionCount(clientA), 1);

  // Unsubscribe from the only user-scoped room
  unsubNotif();

  // Persists by design: maybeRemoveConnection returns early for non-community rooms
  assert.strictEqual(getConnectionCount(clientA), 1,
    "the user socket persists even after all user-scoped rooms are unsubscribed");
  assert.deepStrictEqual(getConnectionKeys(clientA), [userKey(clientA)]);
});

test("closing a user-scoped room does not remove the connection (by design) but does not affect community connections", () => {
  const unsubCommA = clientA.on("chat:community-a", "chat", () => {});
  const unsubNotif = clientA.on("notifications:user-a", "updates", () => {});

  assert.strictEqual(getConnectionCount(clientA), 2);

  unsubNotif();

  // Persists because maybeRemoveConnection returns early for non-community rooms
  const keys = getConnectionKeys(clientA).sort();
  assert.deepStrictEqual(keys, ["chat:community-a", userKey(clientA)].sort());
  assert.strictEqual(getConnectionCount(clientA), 2,
    "the user socket persists (by design: maybeRemoveConnection skips non-community rooms)");

  // But the community connection is unaffected
  unsubCommA();
  assert.strictEqual(getConnectionCount(clientA), 1);
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 4: close() and connect() lifecycle
// ══════════════════════════════════════════════════════════════════════════

test("close() marks all connections as manuallyClosed", () => {
  const unsubComm = clientA.on("chat:community-a", "chat", () => {});
  const unsubNotif = clientA.on("notifications:user-a", "updates", () => {});

  clientA.close();

  assert.strictEqual(isManuallyClosed(clientA, "chat:community-a"), true);
  assert.strictEqual(isManuallyClosed(clientA, userKey(clientA)), true);

  unsubComm();
  unsubNotif();
});

test("connect() after close() sets manuallyClosed to false", () => {
  const unsub = clientA.on("chat:community-a", "chat", () => {});

  clientA.close();
  assert.strictEqual(isManuallyClosed(clientA, "chat:community-a"), true);

  clientA.connect();
  assert.strictEqual(isManuallyClosed(clientA, "chat:community-a"), false);

  unsub();
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 5: Mixed community + user-scoped rooms
// ══════════════════════════════════════════════════════════════════════════

test("User A: Community A → conn-A, Community B → conn-B, user socket → conn-C; closing A does not affect B or C", () => {
  const unsubCommA = clientA.on("chat:community-a", "chat", () => {});
  const unsubCommB = clientA.on("chat:community-b", "chat", () => {});
  const unsubNotif = clientA.on("notifications:user-a", "updates", () => {});

  assert.strictEqual(getConnectionCount(clientA), 3);
  const keysBefore = getConnectionKeys(clientA).sort();
  assert.deepStrictEqual(keysBefore, ["chat:community-a", "chat:community-b", userKey(clientA)].sort());

  unsubCommA();

  const keysAfter = getConnectionKeys(clientA).sort();
  assert.deepStrictEqual(keysAfter, ["chat:community-b", userKey(clientA)].sort());
  assert.strictEqual(getConnectionCount(clientA), 2);

  unsubCommB();
  unsubNotif();
});

// ══════════════════════════════════════════════════════════════════════════
// TEST 6: subscribe() is reference-counted (regression: tab-hide teardown)
// ══════════════════════════════════════════════════════════════════════════

test("one hook releasing subscribe() does not tear down a room another hook still holds", () => {
  // Simulates useTypingPresence + useRealtimeChat + useSidebarRealtime all
  // holding chat:community-a. Typing hook is visibility-gated and releases
  // first; the socket must survive for the others.
  const releaseTyping = clientA.subscribe("chat:community-a");
  const releaseChat = clientA.subscribe("chat:community-a");
  const releaseSidebar = clientA.subscribe("chat:community-a");
  const unsubTyping = clientA.on("chat:community-a", "typing", () => {});

  assert.strictEqual(getConnectionCount(clientA), 1);

  // Tab hidden → typing hook cleans up
  unsubTyping();
  releaseTyping();
  assert.strictEqual(getConnectionCount(clientA), 1, "room still held by chat + sidebar");

  // Releasing twice is idempotent — must not steal another hook's ref
  releaseTyping();
  releaseChat();
  assert.strictEqual(getConnectionCount(clientA), 1, "room still held by sidebar");

  releaseSidebar();
  assert.strictEqual(getConnectionCount(clientA), 0, "last holder released → connection removed");
});

test("removing a community connection marks it manuallyClosed so a late onclose cannot reconnect", () => {
  const unsub = clientA.on("chat:community-a", "chat", () => {});
  const conn = (clientA.connections as Map<string, any>).get("chat:community-a");
  assert.ok(conn);

  unsub();

  assert.strictEqual(conn.manuallyClosed, true);
  assert.strictEqual(conn.reconnectTimer, null);
  assert.strictEqual(conn.ws, null);
  assert.strictEqual(getConnectionCount(clientA), 0);
});

test("re-subscribing after teardown creates a fresh connection carrying the user", () => {
  clientA.init({ id: "user-a", name: "Alice", avatar: null });
  const unsub1 = clientA.on("chat:community-a", "typing", () => {});
  unsub1();
  assert.strictEqual(getConnectionCount(clientA), 0);

  const unsub2 = clientA.on("chat:community-a", "typing", () => {});
  assert.strictEqual(getConnectionCount(clientA), 1);
  assert.deepStrictEqual(getUserOnConnection(clientA, "chat:community-a"), { id: "user-a", name: "Alice", avatar: null });
  assert.strictEqual(isManuallyClosed(clientA, "chat:community-a"), false);
  unsub2();
});

test("multiple community connections are fully independent", () => {
  const unsubA = clientA.on("chat:comm-a", "chat", () => {});
  const unsubB = clientA.on("chat:comm-b", "chat", () => {});
  const unsubC = clientA.on("chat:comm-c", "chat", () => {});

  assert.strictEqual(getConnectionCount(clientA), 3);

  unsubA();
  assert.strictEqual(getConnectionCount(clientA), 2);
  assert.deepStrictEqual(getConnectionKeys(clientA).sort(), ["chat:comm-b", "chat:comm-c"]);

  unsubB();
  assert.strictEqual(getConnectionCount(clientA), 1);
  assert.deepStrictEqual(getConnectionKeys(clientA), ["chat:comm-c"]);

  unsubC();
  assert.strictEqual(getConnectionCount(clientA), 0);
});
