/**
 * The stores' own write paths.
 *
 * Components render these stores directly now, so what matters is that every
 * write announces itself (or the rows would not re-render) and that a patch is
 * mirrored into the cached snapshot (or a replay inside the stale window would
 * resurrect what the patch just replaced).
 */
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import {
  EXPLORE_STORE_CHANGED_EVENT,
  exploreStore,
  setExploreCommunities,
} from "./explore-store";
import {
  SIDEBAR_CHANGED_EVENT,
  SIDEBAR_STORE_CHANGED_EVENT,
  patchSidebarReaction,
  setSidebarCommunities,
  sidebarStore,
  updateSidebarCommunities,
} from "./sidebar-store";
import { getCachedRequest, setCachedRequest } from "../../request-cache";
import type { CachedExploreCommunity, CachedSidebarCommunity } from "./types";

const DESIGN_SYSTEM = "11111111-1111-4111-8111-111111111111";

function row(id: string, overrides: Partial<CachedSidebarCommunity> = {}): CachedSidebarCommunity {
  return { id, name: `Community ${id}`, ...overrides } as unknown as CachedSidebarCommunity;
}

function exploreRows(): CachedExploreCommunity[] {
  return [
    {
      id: DESIGN_SYSTEM,
      name: "Design system",
      type: "user",
      image_url: null,
      description: null,
      member_count: 3,
      joined: false,
      can_join: true,
    },
  ];
}

let announced: string[] = [];

beforeEach(() => {
  announced = [];
  sidebarStore.data = null;
  sidebarStore.inflight = null;
  exploreStore.data = null;
  exploreStore.inflight = null;
  setCachedRequest("/api/communities", { communities: [] });
  (globalThis as { window?: unknown }).window = {
    dispatchEvent: (event: Event) => {
      announced.push(event.type);
      return true;
    },
  };
});

after(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("setSidebarCommunities replaces the rows and announces the store change", () => {
  setSidebarCommunities([row("a"), row("b")]);

  assert.deepEqual(sidebarStore.data?.communities.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(announced, [SIDEBAR_STORE_CHANGED_EVENT]);
});

test("setExploreCommunities stamps fetchedAt and announces the store change", () => {
  setExploreCommunities(exploreRows(), { fetchedAt: 42 });

  assert.equal(exploreStore.data?.communities.length, 1);
  assert.equal(exploreStore.data?.fetchedAt, 42);
  assert.deepEqual(announced, [EXPLORE_STORE_CHANGED_EVENT]);
});

test("a row patch reaches the store and the cached snapshot together", () => {
  setSidebarCommunities([row("a"), row("b")]);
  setCachedRequest("/api/communities", { communities: [row("a"), row("b")] });
  announced = [];

  updateSidebarCommunities((current) =>
    current.map((c) => (c.id === "a" ? { ...c, message_count: 9 } : c)),
  );

  const patched = (rows: CachedSidebarCommunity[]) =>
    rows.find((c) => c.id === "a")?.message_count;
  assert.equal(patched(sidebarStore.data!.communities), 9);
  assert.equal(
    patched(getCachedRequest<{ communities: CachedSidebarCommunity[] }>("/api/communities")!.communities),
    9,
    "a stale-window replay must not resurrect the old count",
  );
  assert.deepEqual(announced, [SIDEBAR_STORE_CHANGED_EVENT]);
});

test("the cached snapshot is patched even before the sidebar has loaded", () => {
  // A chat opened straight from a link can send before the sidebar ever fetched:
  // its optimistic preview still has to survive the next cache-hit replay.
  setCachedRequest("/api/communities", { communities: [row("a")] });

  updateSidebarCommunities((current) =>
    current.map((c) => (c.id === "a" ? { ...c, message_count: 1 } : c)),
  );

  const cached = getCachedRequest<{ communities: CachedSidebarCommunity[] }>("/api/communities")!;
  assert.equal(cached.communities[0].message_count, 1);
  assert.equal(sidebarStore.data, null, "and nothing pretends the sidebar was loaded");
  assert.deepEqual(announced, [], "no rows, so no re-render to announce");
});

test("a reaction preview re-renders the list without asking it to refetch", () => {
  setSidebarCommunities([row("a")]);
  announced = [];

  patchSidebarReaction("a", {
    messageId: "m1",
    emoji: "🔥",
    firstName: "You",
    isOwn: true,
    messagePreview: '"hi"',
  });

  assert.equal(sidebarStore.data?.communities[0].lastReaction?.emoji, "🔥");
  assert.deepEqual(announced, [SIDEBAR_STORE_CHANGED_EVENT]);
  assert.ok(
    !announced.includes(SIDEBAR_CHANGED_EVENT),
    "the cached snapshot predates the reaction, so a refetch here would clobber it",
  );
});
