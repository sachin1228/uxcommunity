import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  getReadState,
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
  readManagerConfig.maxEntries = originalConfig.maxEntries;
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

test("evicts the oldest entries when the cache exceeds the max size", async () => {
  readManagerConfig.debounceMs = 10;
  readManagerConfig.maxEntries = 3;
  installPatchCounter();

  // Insert more communities than the limit. Each debounce timer fires (and the
  // PATCH resolves) before the next insert, so every entry is fully dormant and
  // eligible for eviction.
  for (const id of ["c1", "c2", "c3", "c4", "c5"]) {
    scheduleMarkRead(id, { unreadCount: 1 });
    await delay(30);
  }

  // The two oldest entries were evicted; the newest three remain.
  assert.equal(getReadState("c1"), undefined);
  assert.equal(getReadState("c2"), undefined);
  assert.notEqual(getReadState("c3"), undefined);
  assert.notEqual(getReadState("c4"), undefined);
  assert.notEqual(getReadState("c5"), undefined);
});

test("keeps communities with pending timers or in-flight requests during eviction", async () => {
  readManagerConfig.debounceMs = 10;
  readManagerConfig.maxEntries = 3;

  // "active" has a pending debounce timer (long window so it never fires).
  readManagerConfig.debounceMs = 60_000;
  scheduleMarkRead("active", { unreadCount: 1 });

  // "inflight" has a PATCH that never resolves.
  const calls: string[] = [];
  let hangFetch = false;
  let resolveFetch: () => void = () => {};
  readManagerConfig.debounceMs = 10;
  globalThis.fetch = (async (input) => {
    calls.push(`${String(input)} PATCH`);
    if (hangFetch) {
      await new Promise<void>((resolve) => {
        resolveFetch = resolve;
      });
    }
    return new Response(JSON.stringify({ ok: true, previousLastReadAt: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  hangFetch = true;
  scheduleMarkRead("inflight", { unreadCount: 1 });
  await waitFor(() => calls.length === 1);

  // Insert 4 fully dormant entries (their PATCHes resolve immediately) — well
  // past the limit. Only dormant entries may be evicted; "active" and
  // "inflight" must survive.
  hangFetch = false;
  for (const id of ["c1", "c2", "c3", "c4"]) {
    scheduleMarkRead(id, { unreadCount: 1 });
    await delay(30);
  }

  assert.notEqual(getReadState("active"), undefined);
  assert.notEqual(getReadState("inflight"), undefined);
  assert.equal(getReadState("c1"), undefined);
  assert.equal(getReadState("c2"), undefined);
  assert.equal(getReadState("c3"), undefined);
  assert.notEqual(getReadState("c4"), undefined);

  // The protected "active" community kept its pending timer: flushing it still
  // fires the mark-read PATCH.
  flushMarkRead("active");
  await waitFor(() => calls.includes("/api/communities/active/read PATCH"));
  resolveFetch();
});

test("regression: sidebar navigation + route-change effect send only one PATCH", async () => {
  // Regression test for a production bug: clicking a community in the sidebar
  // calls handleNavigate(), which calls scheduleMarkRead() and then
  // router.push(). The route change fires the activeCommunityId effect, which
  // calls scheduleMarkRead() again for the same community. Before the debounce
  // collapse, those two events produced TWO PATCH requests for the same
  // community. This test pins the behavior: both events must collapse into a
  // single PATCH, and the cooldown must suppress any immediate follow-up.
  readManagerConfig.debounceMs = 20;
  readManagerConfig.cooldownMs = 30_000;
  const calls = installPatchCounter();

  // 1. Sidebar click → handleNavigate.
  scheduleMarkRead("abc123", { unreadCount: 3, reason: "sidebar navigation" });
  // 2. Route change → pathname/community effect.
  scheduleMarkRead("abc123", { unreadCount: 3, reason: "community opened" });

  await waitFor(() => calls.length === 1);
  await delay(60);

  assert.equal(calls.length, 1);
  assert.equal(calls[0], "/api/communities/abc123/read PATCH");

  // A second navigation pair within the cooldown window must NOT send another
  // PATCH — the cooldown prevents the immediate duplicate request.
  scheduleMarkRead("abc123", { unreadCount: 1, reason: "sidebar navigation" });
  scheduleMarkRead("abc123", { unreadCount: 1, reason: "community opened" });
  await delay(60);
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
