import { invalidateRequest, setCachedRequest } from "@/lib/request-cache";
import type { CachedExploreCommunity, CachedSidebarCommunity } from "./types";
import { notifySidebarChanged } from "./events";
import { clearAllReactionTombstones } from "./reaction-tombstones";
import {
  evictCommunityState,
  inFlightMetaFetch,
  inFlightMsgFetch,
  lastReadAtOnOpen,
  metaCache,
  msgCache,
  msgFetchedAt,
} from "./chat-store";

export const sidebarStore: {
  data: { communities: CachedSidebarCommunity[]; fetchedAt: number } | null;
  inflight: Promise<void> | null;
} = { data: null, inflight: null };

export const SIDEBAR_STALE_MS = 60_000;

export const exploreStore: {
  data: { communities: CachedExploreCommunity[]; fetchedAt: number } | null;
  inflight: Promise<void> | null;
} = { data: null, inflight: null };

export const EXPLORE_STALE_MS = 5 * 60_000;

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
  clearAllReactionTombstones();
  inFlightMsgFetch.clear();
  inFlightMetaFetch.clear();
  sidebarStore.data     = null;
  sidebarStore.inflight = null;
  exploreStore.data     = null;
  exploreStore.inflight = null;
  cachedUserId          = null;
}

// ─── Cache-invalidation helpers (join / leave) ────────────────────────────────

export function invalidateOnJoin(communityId: string): void {
  if (exploreStore.data) {
    exploreStore.data = {
      ...exploreStore.data,
      communities: exploreStore.data.communities.map((c) =>
        c.id === communityId ? { ...c, joined: true } : c
      ),
    };
  }
  sidebarStore.data     = null;
  sidebarStore.inflight = null;
  invalidateRequest("/api/communities");
  notifySidebarChanged();
}

export function invalidateCommunitiesList(): void {
  sidebarStore.data     = null;
  sidebarStore.inflight = null;
  exploreStore.data     = null;
  exploreStore.inflight = null;
  invalidateRequest("/api/communities");
  notifySidebarChanged();
}

export function invalidateOnLeave(communityId: string): void {
  if (exploreStore.data) {
    exploreStore.data = {
      ...exploreStore.data,
      communities: exploreStore.data.communities.map((c) =>
        c.id === communityId ? { ...c, joined: false } : c
      ),
    };
  }
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.filter((c) => c.id !== communityId),
    };
    setCachedRequest("/api/communities", {
      communities: sidebarStore.data.communities,
    });
  } else {
    invalidateRequest("/api/communities");
  }
  evictCommunityState(communityId);
  notifySidebarChanged();
}

/** Remove a community from all caches after it has been hard-deleted. */
export function invalidateOnCommunityDeleted(communityId: string): void {
  if (exploreStore.data) {
    exploreStore.data = {
      ...exploreStore.data,
      communities: exploreStore.data.communities.filter((c) => c.id !== communityId),
    };
  }
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.filter((c) => c.id !== communityId),
    };
    setCachedRequest("/api/communities", {
      communities: sidebarStore.data.communities,
    });
  } else {
    invalidateRequest("/api/communities");
  }
  evictCommunityState(communityId);
  notifySidebarChanged();
}


export function invalidateOnArchive(communityId: string): void {
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.map((c) =>
        c.id === communityId ? { ...c, is_archived: true } : c
      ),
    };
  }
  evictCommunityState(communityId);
  notifySidebarChanged();
}
