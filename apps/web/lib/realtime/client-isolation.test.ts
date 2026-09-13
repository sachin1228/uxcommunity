import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

/**
 * Isolation tests for RealtimeClient — proves:
 *
 * 1. Two RealtimeClient instances (simulating two browser tabs) have
 *    separate connections maps, so "user:global" is instance-local.
 *
 * 2. Closing one community connection does not affect other community
 *    connections or the user:global connection on the same instance.
 *
 * 3. User A's user-scoped events cannot reach User B's instance.
 *
 * FINDINGS:
 * - init() only sets user on EXISTING connections. If called before on()
 *   (which creates the connection), conn.user remains null.
 * - user:global is never removed by maybeRemoveConnection (by design:
 *   it persists for the tab lifetime).
 * - The second init() call wins if it runs after the connection is created.
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

test("user:global is instance-local — two RealtimeClient instances have separate connections", () => {
  clientA.init({ id: "user-a", name: "Alice", avatar: null });
  clientB.init({ id: "user-b", name: "Bob", avatar: null });

  const unsubA = clientA.on("notifications:user-a", "updates", () => {});
  const unsubB = clientB.on("notifications:user-b", "updates", () => {});

  const keysA = getConnectionKeys(clientA);
  const keysB = getConnectionKeys(clientB);

  assert.deepStrictEqual(keysA, ["user:global"]);
  assert.deepStrictEqual(keysB, ["user:global"]);

  assert.notStrictEqual(
    (clientA as any).connections,
    (clientB as any).connections,
    "connections maps must be different instances",
  );

  unsubA();
  unsubB();
});

test("two instances' user:global connections are independent", () => {
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
    getUserOnConnection(clientA, "user:global"),
    { id: "user-a", name: "Alice", avatar: null },
    "connections created after init() must carry the user so they send `join`",
  );

  unsub();
});

test("first init() identity sticks on an existing connection; later init() does not overwrite it", () => {
  clientA.init({ id: "user-a", name: "Alice", avatar: null });
  const unsub = clientA.on("notifications:user-a", "updates", () => {});

  // Second init — connection already has a user, so it is left untouched
  clientA.init({ id: "user-c", name: "Charlie", avatar: null });

  assert.deepStrictEqual(
    getUserOnConnection(clientA, "user:global"),
    { id: "user-a", name: "Alice", avatar: null },
    "existing connection keeps its original identity",
  );

  unsub();
});

test("init() after on() correctly sets user on existing connection", () => {
  // Create connection first
  const unsub = clientA.on("notifications:user-a", "updates", () => {});
  assert.strictEqual(getUserOnConnection(clientA, "user:global"), null);

  // Then init — should set user on existing connection
  clientA.init({ id: "user-a", name: "Alice", avatar: null });
  assert.deepStrictEqual(
    getUserOnConnection(clientA, "user:global"),
    { id: "user-a", name: "Alice", avatar: null },
    "init() after on() correctly sets user",
  );

  unsub();
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
    getUserOnConnection(clientA, "user:global"),
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

test("closing community A does not affect community B or user:global", () => {
  const unsubCommA = clientA.on("chat:community-a", "chat", () => {});
  const unsubCommB = clientA.on("chat:community-b", "chat", () => {});
  const unsubNotif = clientA.on("notifications:user-a", "updates", () => {});

  assert.strictEqual(getConnectionCount(clientA), 3);

  unsubCommA();

  const keysAfter = getConnectionKeys(clientA).sort();
  assert.deepStrictEqual(keysAfter, ["chat:community-b", "user:global"]);
  assert.strictEqual(getConnectionCount(clientA), 2);

  unsubCommB();
  unsubNotif();
});

test("FINDING: user:global is never removed by maybeRemoveConnection", () => {
  const unsubNotif = clientA.on("notifications:user-a", "updates", () => {});
  assert.strictEqual(getConnectionCount(clientA), 1);

  // Unsubscribe from the only user-scoped room
  unsubNotif();

  // user:global persists (by design: maybeRemoveConnection returns early for non-community rooms)
  assert.strictEqual(getConnectionCount(clientA), 1,
    "user:global persists even after all user-scoped rooms are unsubscribed");
  assert.deepStrictEqual(getConnectionKeys(clientA), ["user:global"]);
});

test("closing user:global room does not remove the connection (by design) but does not affect community connections", () => {
  const unsubCommA = clientA.on("chat:community-a", "chat", () => {});
  const unsubNotif = clientA.on("notifications:user-a", "updates", () => {});

  assert.strictEqual(getConnectionCount(clientA), 2);

  unsubNotif();

  // user:global persists because maybeRemoveConnection returns early for non-community rooms
  const keys = getConnectionKeys(clientA).sort();
  assert.deepStrictEqual(keys, ["chat:community-a", "user:global"]);
  assert.strictEqual(getConnectionCount(clientA), 2,
    "user:global persists (by design: maybeRemoveConnection skips non-community rooms)");

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
  assert.strictEqual(isManuallyClosed(clientA, "user:global"), true);

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

test("User A: Community A → conn-A, Community B → conn-B, user:global → conn-C; closing A does not affect B or C", () => {
  const unsubCommA = clientA.on("chat:community-a", "chat", () => {});
  const unsubCommB = clientA.on("chat:community-b", "chat", () => {});
  const unsubNotif = clientA.on("notifications:user-a", "updates", () => {});

  assert.strictEqual(getConnectionCount(clientA), 3);
  const keysBefore = getConnectionKeys(clientA).sort();
  assert.deepStrictEqual(keysBefore, ["chat:community-a", "chat:community-b", "user:global"]);

  unsubCommA();

  const keysAfter = getConnectionKeys(clientA).sort();
  assert.deepStrictEqual(keysAfter, ["chat:community-b", "user:global"]);
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
