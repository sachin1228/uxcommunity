import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { clearAllUserCaches, msgCache, seedCachedMessages } from "./cache";
import {
  clearRequestCache,
  fetchAndHydrateCommunityBootstrap,
  initRequestCache,
} from "@/lib/request-cache";
import type { CachedMessage } from "./cache";

const originalFetch = globalThis.fetch;

afterEach(() => {
  clearRequestCache();
  clearAllUserCaches();
  globalThis.fetch = originalFetch;
});

function message(overrides: Partial<CachedMessage> = {}): CachedMessage {
  return {
    id: "message-1",
    content: "okay man",
    created_at: "2026-09-13T02:50:00.000Z",
    user_id: "john",
    users: null,
    reactions: [],
    ...overrides,
  };
}

/** Serves one bootstrap snapshot; every later call comes from the request cache. */
function mockBootstrap(messages: CachedMessage[]): () => number {
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    assert.match(String(input), /\/bootstrap$/);
    return new Response(
      JSON.stringify({
        community: { community: { id: "community-1" }, members: [] },
        messages: { messages },
        permissions: { role: "member", can_manage: false },
        unreadCount: 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return () => calls;
}

async function loadBootstrapMessages(): Promise<CachedMessage[]> {
  const bootstrap = await fetchAndHydrateCommunityBootstrap("community-1", "user-a");
  return (bootstrap.messages as { messages: CachedMessage[] }).messages;
}

test("a bootstrap snapshot seeds an empty message cache", async () => {
  initRequestCache("user-a");
  mockBootstrap([message()]);

  assert.equal(seedCachedMessages("community-1", await loadBootstrapMessages()), true);
  assert.equal(msgCache.get("community-1")?.length, 1);
});

test("a stale cached bootstrap never replaces the user's own reaction", async () => {
  initRequestCache("user-a");
  const fetchCalls = mockBootstrap([message()]);

  // First visit: the server page has no reaction yet.
  seedCachedMessages("community-1", await loadBootstrapMessages());

  // The user reacts — the live cache is the source of truth from here on.
  msgCache.set("community-1", [
    { ...message(), reactions: [{ emoji: "👍", user_ids: ["user-a"] }] },
  ]);

  // Switch away and back. The bootstrap is reused from the 15-minute request
  // cache, so it still describes the pre-reaction message.
  const reapplied = seedCachedMessages("community-1", await loadBootstrapMessages());

  assert.equal(fetchCalls(), 1, "the return visit reuses the cached bootstrap");
  assert.equal(reapplied, false, "the stale snapshot must not be applied");
  assert.deepEqual(msgCache.get("community-1")?.[0]?.reactions, [
    { emoji: "👍", user_ids: ["user-a"] },
  ]);
});

test("a bootstrap snapshot does not drop messages received after it was cached", async () => {
  initRequestCache("user-a");
  mockBootstrap([message()]);

  seedCachedMessages("community-1", await loadBootstrapMessages());

  // A realtime message arrives after the snapshot was taken.
  msgCache.set("community-1", [
    ...(msgCache.get("community-1") ?? []),
    message({ id: "message-2", content: "hi" }),
  ]);

  seedCachedMessages("community-1", await loadBootstrapMessages());

  assert.deepEqual(
    msgCache.get("community-1")?.map((cached) => cached.id),
    ["message-1", "message-2"],
  );
});
