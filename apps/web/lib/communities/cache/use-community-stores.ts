"use client";

/**
 * React bindings for the two community list stores.
 *
 * WHY THIS EXISTS
 *   Both lists used to be copied into component state and re-synced by hand:
 *   the Explore page kept a `communities` array it patched alongside the store,
 *   and the sidebar kept one it re-synced from three different window events.
 *   Two copies of one list is how they drift — a write from another surface, or
 *   an event a listener forgot, leaves one view showing yesterday's answer.
 *
 *   Rendering the store itself removes the second copy: `useSyncExternalStore`
 *   subscribes to the store's own change event and re-reads the rows, so a write
 *   anywhere reaches every reader. Component state is only for what the server
 *   has not answered yet (loading, search, an open dialog).
 *
 * Server rendering: the snapshot is the module state, which is empty on the
 * server, so the server paints the empty state exactly as before hydration.
 */

import { useSyncExternalStore } from "react";
import {
  EXPLORE_STORE_CHANGED_EVENT,
  exploreStore,
} from "./explore-store";
import {
  SIDEBAR_STORE_CHANGED_EVENT,
  sidebarStore,
} from "./sidebar-store";
import type { CachedExploreCommunity, CachedSidebarCommunity } from "./types";

/**
 * Stable empties. The snapshot must keep its identity between renders unless the
 * store actually changed, or React would re-render forever — so an empty list is
 * one shared frozen array, not a fresh `[]` per read.
 */
const NO_EXPLORE_ROWS: CachedExploreCommunity[] = [];
const NO_SIDEBAR_ROWS: CachedSidebarCommunity[] = [];

function subscribeTo(event: string) {
  return (listener: () => void) => {
    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  };
}

const subscribeToExplore = subscribeTo(EXPLORE_STORE_CHANGED_EVENT);
const subscribeToSidebar = subscribeTo(SIDEBAR_STORE_CHANGED_EVENT);

/** The cached Explore rows, re-read whenever any surface changes them. */
export function useExploreCommunities(): CachedExploreCommunity[] {
  return useSyncExternalStore(
    subscribeToExplore,
    () => exploreStore.data?.communities ?? NO_EXPLORE_ROWS,
    () => NO_EXPLORE_ROWS,
  );
}

/** The cached sidebar rows — the same rows realtime, mark-read and joins write. */
export function useSidebarCommunityRows(): CachedSidebarCommunity[] {
  return useSyncExternalStore(
    subscribeToSidebar,
    () => sidebarStore.data?.communities ?? NO_SIDEBAR_ROWS,
    () => NO_SIDEBAR_ROWS,
  );
}
