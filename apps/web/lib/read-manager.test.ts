import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  initReadManager,
  noteCommunityActivity,
  readManagerConfig,
  resetReadManager,
  scheduleMarkRead,
  flushMarkRead,
} from "./communities/read-manager";

const originalFetch = globalThis.fetch;
const originalConfig = { ...readManagerConfig };

afterEach(() => {
  resetReadManager();
  globalThis.fetch = originalFetch;
  readManagerConfig.debounceMs = originalConfig.debounceMs;
  readManagerConfig.cooldownMs = originalConfig.cooldownMs;
});

/** Counts PATCH requests to /read for a community. */
function installPatchCounter() {
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    calls.push(`${String(input)} ${init?.method ?? "GET"}`);
    return new Response(JSON.stringify({ ok: true, previousLastReadAt: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for state");
    await delay(10);
  }
}

test("collapses rapid triggers into a single PATCH", async () => {
  readManagerConfig.debounceMs = 20;
  const calls = installPatchCounter();

  // Simulate: open page → component mount → focus event → realtime message.
  scheduleMarkRead("abc123", { unreadCount: 5, reason: "community opened" });
  scheduleMarkRead("abc123", { unreadCount: 5, reason: "component mount" });
  scheduleMarkRead("abc123", { unreadCount: 1, reason: "focus event" });
  scheduleMarkRead("abc123", { unreadCount: 1, reason: "realtime message" });

  await waitFor(() => calls.length >= 1);
  await delay(40);

  assert.equal(calls.length, 1);
  assert.equal(calls[0], "/api/communities/abc123/read PATCH");
});

test("skips a PATCH when the unread count is already 0", async () => {
  readManagerConfig.debounceMs = 20;
  const calls = installPatchCounter();

  scheduleMarkRead("abc123", { unreadCount: 0, reason: "community opened" });

  await delay(60);
  assert.equal(calls.length, 0);
});

test("enforces a 30s cooldown between PATCHes for the same community", async () => {
  readManagerConfig.debounceMs = 10;
  readManagerConfig.cooldownMs = 30_000;
  const calls = installPatchCounter();

  scheduleMarkRead("abc123", { unreadCount: 3 });
  await waitFor(() => calls.length === 1);

  // Same community re-opened within the cooldown window.
  scheduleMarkRead("abc123", { unreadCount: 2 });
  await delay(60);
  assert.equal(calls.length, 1);

  // Once the cooldown passes, a new unread event can PATCH again.
  readManagerConfig.cooldownMs = 1;
  await delay(5);
  scheduleMarkRead("abc123", { unreadCount: 1 });
  await waitFor(() => calls.length === 2);
});

test("deduplicates while a PATCH is already in flight", async () => {
  readManagerConfig.debounceMs = 10;
  let resolveFetch: () => void = () => {};
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    await new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    return new Response(JSON.stringify({ ok: true, previousLastReadAt: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  scheduleMarkRead("abc123", { unreadCount: 4 });
  await waitFor(() => calls === 1);

  // New activity while the first PATCH is still unresolved.
  scheduleMarkRead("abc123", { unreadCount: 2 });
  await delay(60);
  assert.equal(calls, 1);

  resolveFetch();
  await delay(10);
  assert.equal(calls, 1);
});

test("keeps the highest unread count seen since the last mark-read", async () => {
  readManagerConfig.debounceMs = 10;
  const calls = installPatchCounter();

  // handleNavigate reports 3 unread, then the pathname effect observes the
  // optimistically-zeroed badge and reports 0 — the PATCH must still fire.
  scheduleMarkRead("abc123", { unreadCount: 3, reason: "sidebar navigation" });
  scheduleMarkRead("abc123", { unreadCount: 0, reason: "community opened" });

  await waitFor(() => calls.length === 1);
  assert.equal(calls.length, 1);
});

test("realtime activity feeds the next open decision", async () => {
  readManagerConfig.debounceMs = 10;
  const calls = installPatchCounter();

  // A message arrives while the user is elsewhere; the manager records it.
  noteCommunityActivity("abc123", { unreadCount: 1, lastMessageTimestamp: "2026-08-14T12:00:00.000Z" });

  // The user re-opens the community; the snapshot may be zeroed, but the
  // tracked activity should still trigger exactly one PATCH.
  scheduleMarkRead("abc123", { unreadCount: 0, reason: "community opened" });

  await waitFor(() => calls.length === 1);
  assert.equal(calls.length, 1);
});

test("flushMarkRead fires the pending decision immediately", async () => {
  readManagerConfig.debounceMs = 60_000; // long window — flush bypasses it
  const calls = installPatchCounter();

  scheduleMarkRead("abc123", { unreadCount: 2 });
  flushMarkRead("abc123");

  await waitFor(() => calls.length === 1);
  assert.equal(calls.length, 1);
});

test("initReadManager clears tracked state when the user changes", async () => {
  readManagerConfig.debounceMs = 10;
  const calls = installPatchCounter();

  initReadManager("user-a");
  scheduleMarkRead("abc123", { unreadCount: 2 });
  await waitFor(() => calls.length === 1);

  initReadManager("user-b");
  scheduleMarkRead("abc123", { unreadCount: 0 });
  await delay(60);
  assert.equal(calls.length, 1);
});
