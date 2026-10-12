/**
 * The one writer behind "where does the viewer stand with this community".
 *
 * These are the guarantees the surfaces rely on: a request filed from the home
 * feed cannot leave Explore offering "Request to join" again, a join clears the
 * pending flag and refreshes the sidebar projection, and a surface that merely
 * re-read the truth from a fetch is not mistaken for a change.
 */
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { EXPLORE_STORE_CHANGED_EVENT, exploreStore } from "./explore-store";
import {
  SIDEBAR_CHANGED_EVENT,
  invalidateOnJoin,
  setCommunityViewerState,
  sidebarStore,
  syncCommunityViewerState,
} from "./sidebar-store";
import type { CachedExploreCommunity, CachedSidebarCommunity } from "./types";

const DESIGN_SYSTEM = "11111111-1111-4111-8111-111111111111";
const SOMEWHERE_ELSE = "22222222-2222-4222-8222-222222222222";

function exploreRow(overrides: Partial<CachedExploreCommunity> = {}): CachedExploreCommunity {
  return {
    id: DESIGN_SYSTEM,
    name: "Design system",
    type: "user",
    image_url: null,
    description: null,
    member_count: 3,
    joined: false,
    can_join: true,
    ...overrides,
  };
}

function sidebarRow(): CachedSidebarCommunity {
  return { id: DESIGN_SYSTEM, name: "Design system" } as unknown as CachedSidebarCommunity;
}

/** What the writer told the rest of the app to re-render, in order. */
let announced: string[] = [];

function cachedRow(): CachedExploreCommunity {
  const found = exploreStore.data?.communities.find((c) => c.id === DESIGN_SYSTEM);
  assert.ok(found, "the community should still be in the cached list");
  return found;
}

beforeEach(() => {
  announced = [];
  exploreStore.data = { communities: [exploreRow()], fetchedAt: 0 };
  exploreStore.inflight = null;
  sidebarStore.data = null;
  sidebarStore.inflight = null;
  // The writer announces through `window`, which node does not have.
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

test("a request is recorded as pending, with membership untouched", () => {
  setCommunityViewerState(DESIGN_SYSTEM, { joined: false, hasPendingRequest: true });

  assert.equal(cachedRow().has_pending_request, true);
  assert.equal(cachedRow().joined, false);
  assert.deepEqual(announced, [EXPLORE_STORE_CHANGED_EVENT]);
});

test("a join records the membership and clears the pending request", () => {
  setCommunityViewerState(DESIGN_SYSTEM, { joined: false, hasPendingRequest: true });
  announced = [];

  setCommunityViewerState(DESIGN_SYSTEM, { joined: true });

  assert.equal(cachedRow().joined, true);
  assert.equal(cachedRow().has_pending_request, false);
  // Two facts, two events: the sidebar's membership list is stale (refetch) and
  // the Explore projection moved (re-render from the store).
  assert.deepEqual(announced, [SIDEBAR_CHANGED_EVENT, EXPLORE_STORE_CHANGED_EVENT]);
});

test("a request leaves the sidebar alone, a join drops its stale list", () => {
  sidebarStore.data = { communities: [sidebarRow()], fetchedAt: 0 };

  setCommunityViewerState(DESIGN_SYSTEM, { joined: false, hasPendingRequest: true });
  assert.ok(sidebarStore.data, "a pending request changes no membership");

  setCommunityViewerState(DESIGN_SYSTEM, { joined: true });
  assert.equal(sidebarStore.data, null, "the sidebar list is stale once the viewer belongs");
});

test("a withdraw clears the flag and joins nothing", () => {
  setCommunityViewerState(DESIGN_SYSTEM, { joined: false, hasPendingRequest: true });
  announced = [];

  setCommunityViewerState(DESIGN_SYSTEM, { joined: false });

  assert.equal(cachedRow().has_pending_request, false);
  assert.equal(cachedRow().joined, false);
  assert.deepEqual(announced, [EXPLORE_STORE_CHANGED_EVENT]);
});

test("a fetch that confirms the cached row rewrites nothing and stays silent", () => {
  setCommunityViewerState(DESIGN_SYSTEM, { joined: false, hasPendingRequest: true });
  announced = [];
  const before = exploreStore.data;

  syncCommunityViewerState(DESIGN_SYSTEM, { joined: false, hasPendingRequest: true });

  assert.equal(exploreStore.data, before, "the list is not rewritten for nothing");
  assert.deepEqual(announced, [], "and no surface is told to re-render");
});

test("a fetch corrects a stale row without dropping the sidebar", () => {
  sidebarStore.data = { communities: [sidebarRow()], fetchedAt: 0 };

  syncCommunityViewerState(DESIGN_SYSTEM, { joined: true });

  assert.equal(cachedRow().joined, true);
  assert.ok(sidebarStore.data, "re-reading the truth is not a membership change");
  assert.deepEqual(announced, [EXPLORE_STORE_CHANGED_EVENT]);
});

test("a community the cached list does not hold is left alone", () => {
  syncCommunityViewerState(SOMEWHERE_ELSE, { joined: true });

  assert.equal(exploreStore.data?.communities.length, 1);
  assert.deepEqual(announced, []);
});

test("invalidateOnJoin is the join writer, whichever surface calls it", () => {
  setCommunityViewerState(DESIGN_SYSTEM, { joined: false, hasPendingRequest: true });
  sidebarStore.data = { communities: [sidebarRow()], fetchedAt: 0 };

  invalidateOnJoin(DESIGN_SYSTEM);

  assert.equal(cachedRow().joined, true);
  assert.equal(cachedRow().has_pending_request, false);
  assert.equal(sidebarStore.data, null);
});
