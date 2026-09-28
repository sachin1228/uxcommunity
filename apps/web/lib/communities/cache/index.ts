/**
 * Module-level caches for community data.
 * These persist across client-side navigations (SPA) without needing
 * React context, Redux, or external libraries.
 *
 * WHY THIS IS A BARREL
 *   This module used to be one 771-line file holding four independent caches
 *   (the sidebar list, the explore list, the per-community chat cache and the
 *   reaction tombstones) plus three unrelated registries (window events, the
 *   settings-modal opener, the content-event mirror). They have different
 *   owners, different staleness and different invalidations, so they now live in
 *   ./cache/*.ts, one per domain.
 *
 *   The import path is deliberately unchanged: ~50 modules import
 *   `@/lib/communities/cache`, and every export they rely on is re-exported
 *   below, so the split is invisible to them.
 *
 * WHAT STAYS HERE
 *   The session boundary. `initUserCache` / `clearAllUserCaches` are the one
 *   operation that has to reach across every domain at once (a new signed-in
 *   member must not see the previous one's data), so it belongs to the module
 *   that can see them all — see also lib/session-cache.ts, which calls it.
 */

import {
  inFlightMetaFetch,
  inFlightMsgFetch,
  lastReadAtOnOpen,
  metaCache,
  msgCache,
  msgFetchedAt,
} from "./community-cache";
import { clearReactionTombstones } from "./reactions";
import { exploreStore } from "./explore-store";
import { sidebarStore } from "./sidebar-store";

export * from "./types";
export * from "./reactions";
export * from "./community-cache";
export * from "./explore-store";
export * from "./sidebar-store";
export * from "./settings-openers";
export * from "./content-mirror";

// ─── User-isolation helpers ───────────────────────────────────────────────────

export let cachedUserId: string | null = null;

export function initUserCache(userId: string): void {
  if (userId && cachedUserId !== userId) {
    clearAllUserCaches();
    cachedUserId = userId;
  }
}

export function clearAllUserCaches(): void {
  msgCache.clear();
  metaCache.clear();
  msgFetchedAt.clear();
  lastReadAtOnOpen.clear();
  clearReactionTombstones();
  inFlightMsgFetch.clear();
  inFlightMetaFetch.clear();
  sidebarStore.data     = null;
  sidebarStore.inflight = null;
  exploreStore.data     = null;
  exploreStore.inflight = null;
  cachedUserId          = null;
}
