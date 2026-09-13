import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  SIDEBAR_CHANGED_EVENT,
  SIDEBAR_STALE_MS,
  clearAllUserCaches,
  exploreStore,
  patchExploreCommunity,
  revalidateSidebarCommunities,
  sidebarStore,
  type CachedExploreCommunity,
  type CachedSidebarCommunity,
} from "./cache";
import {
  clearRequestCache,
  fetchJsonCached,
  initRequestCache,
  setCachedRequest,
} from "@/lib/request-cache";
import { sortSidebarCommunities } from "./sidebar-sort";

const USER_ID = "user-a";
const originalFetch = globalThis.fetch;

afterEach(() => {
  clearRequestCache();
  clearAllUserCaches();
  globalThis.fetch = originalFetch;
  delete (globalThis as { window?: unknown }).window;
});

/** Minimal stand-in for the browser globals the cache helpers touch. */
function installFakeWindow(): EventTarget {
  const fakeWindow = new EventTarget();
  (globalThis as { window?: EventTarget }).window = fakeWindow;
  return fakeWindow;
}

function exploreCommunity(
  overrides: Partial<CachedExploreCommunity> = {},
): CachedExploreCommunity {
  return {
    id: "community-1",
    name: "Accessibility",
    type: "interest",
    image_url: null,
    description: null,
    member_count: 2,
    joined: false,
    can_join: true,
    ...overrides,
  };
}

function sidebarCommunity(
  overrides: Partial<CachedSidebarCommunity> = {},
): CachedSidebarCommunity {
  return {
    id: "community-1",
    name: "Accessibility",
    type: "interest",
    image_url: null,
    member_count: 2,
    message_count: 0,
    joined_at: "2026-09-13T07:00:00.000Z",
    last_message: null,
    ...overrides,
  };
}

// ─── The Explore projection ───────────────────────────────────────────────────

test("patchExploreCommunity marks one community joined without touching the rest", () => {
  exploreStore.data = {
    communities: [
      exploreCommunity({ id: "community-1" }),
      exploreCommunity({ id: "community-2", name: "Typography" }),
    ],
    fetchedAt: Date.now(),
  };

  patchExploreCommunity("community-2", { joined: true });

  assert.deepEqual(
    exploreStore.data.communities.map((c) => [c.id, c.joined]),
    [["community-1", false], ["community-2", true]],
  );
});

test("patchExploreCommunity is a no-op before Explore has been fetched", () => {
  assert.equal(exploreStore.data, null);
  patchExploreCommunity("community-1", { joined: true });
  assert.equal(exploreStore.data, null);
});

// ─── Sidebar revalidation (the join-visibility race) ──────────────────────────

test("a join revalidates the sidebar after the write, not from the click", async () => {
  initRequestCache(USER_ID);
  const fakeWindow = installFakeWindow();
  const sidebarEvents: string[] = [];
  fakeWindow.addEventListener(SIDEBAR_CHANGED_EVENT, () => sidebarEvents.push("changed"));

  // The rows already on screen, and the cached snapshot the sidebar is holding.
  sidebarStore.data = { communities: [sidebarCommunity()], fetchedAt: Date.now() };

  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({
        communities: [
          sidebarCommunity(),
          sidebarCommunity({ id: "community-2", name: "Game Design" }),
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  // A snapshot taken before the membership existed still reads as fresh, so
  // this is the pre-join list the sidebar was about to render.
  setCachedRequest("/api/communities", { communities: [] }, USER_ID);
  const stale = await fetchJsonCached<{ communities: CachedSidebarCommunity[] }>(
    "/api/communities",
    { staleMs: SIDEBAR_STALE_MS },
    USER_ID,
  );
  assert.equal(fetchCalls, 0, "the pre-join snapshot is served without a request");
  assert.deepEqual(stale.communities, []);

  // The join commits… and this is what makes the difference: the cache entry is
  // dropped, so the sidebar's refetch cannot replay the pre-join snapshot.
  revalidateSidebarCommunities();
  assert.deepEqual(sidebarEvents, ["changed"], "the panel is told to refetch");
  assert.equal(
    sidebarStore.data?.communities.length,
    1,
    "the rows on screen survive the revalidation (no spinner flash)",
  );

  const refreshed = await fetchJsonCached<{ communities: CachedSidebarCommunity[] }>(
    "/api/communities",
    { staleMs: SIDEBAR_STALE_MS },
    USER_ID,
  );
  assert.equal(fetchCalls, 1, "the refetch really hits the network");
  assert.deepEqual(
    refreshed.communities.map((c) => c.id),
    ["community-1", "community-2"],
  );
});

// ─── Ordering ────────────────────────────────────────────────────────────────

test("a just-joined community sorts above communities with older activity", () => {
  const justJoined = sidebarCommunity({
    id: "community-new",
    name: "Game Design",
    joined_at: "2026-09-13T12:00:00.000Z",
  });
  const talking = sidebarCommunity({
    id: "community-old",
    name: "Bengaluru Designers",
    joined_at: "2026-08-01T00:00:00.000Z",
    last_message: {
      id: "message-1",
      content: "hi",
      created_at: "2026-09-13T06:55:00.000Z",
      user: { name: "santosh" },
    },
  });

  assert.deepEqual(
    sortSidebarCommunities([talking, justJoined]).map((c) => c.id),
    ["community-new", "community-old"],
  );
});

test("a newer message still outranks a recent join", () => {
  const justJoined = sidebarCommunity({
    id: "community-new",
    name: "Game Design",
    joined_at: "2026-09-13T12:00:00.000Z",
  });
  const busier = sidebarCommunity({
    id: "community-busy",
    name: "Finance & Fintech",
    joined_at: "2026-08-01T00:00:00.000Z",
    last_message: {
      id: "message-2",
      content: "hello",
      created_at: "2026-09-13T12:30:00.000Z",
      user: { name: "john" },
    },
  });

  assert.deepEqual(
    sortSidebarCommunities([justJoined, busier]).map((c) => c.id),
    ["community-busy", "community-new"],
  );
});

test("communities with the same activity fall back to name order", () => {
  const joinedAt = "2026-09-13T09:00:00.000Z";
  const sorted = sortSidebarCommunities([
    sidebarCommunity({ id: "b", name: "Typography", joined_at: joinedAt }),
    sidebarCommunity({ id: "a", name: "Accessibility", joined_at: joinedAt }),
  ]);

  assert.deepEqual(sorted.map((c) => c.id), ["a", "b"]);
});
