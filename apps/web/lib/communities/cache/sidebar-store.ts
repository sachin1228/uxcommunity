/**
 * The sidebar's joined-communities store, its optimistic patches and its
 * invalidation rules.
 *
 * WHY THIS EXISTS
 *   The sidebar list is a projection the user watches change: it is patched
 *   optimistically when a message is sent or a reaction lands, restructured when
 *   a community is joined/left/archived/deleted, and mirrored into the request
 *   cache so a stale-window replay cannot resurrect an older snapshot. Those
 *   rules are one owner's business, and they used to be interleaved with the chat
 *   message cache, the explore cache, the reaction tombstones and a settings-modal
 *   registry in a single 771-line module.
 *
 * WHY THE INVALIDATORS LIVE HERE (and touch Explore)
 *   A join or a leave changes BOTH list projections at once, so the mutators are
 *   in one place rather than split by which store they happen to write; the
 *   explore store itself keeps only its state (see ./explore-store.ts). The
 *   direction is one-way: this module imports the explore store and the community
 *   caches, and they never import it.
 *
 * THE THREE EVENTS ARE DIFFERENT ON PURPOSE
 *   `SIDEBAR_CHANGED_EVENT` means "something structural changed — refetch".
 *   The reaction and message events mean "this is a local optimistic preview that
 *   the cached `/api/communities` snapshot predates", so listeners must NOT
 *   refetch on them; they patch the shared request cache in place, which is what
 *   makes a cache-hit replay safe.
 */

import {
  invalidateRequest,
  patchCachedRequest,
  setCachedRequest,
} from "@/lib/request-cache";
import { evictCommunityState } from "./community-cache";
import { clearReactionTombstone } from "./reactions";
import { exploreStore } from "./explore-store";
import type { CachedSidebarCommunity, SidebarLastReaction } from "./types";

export const sidebarStore: {
  data: { communities: CachedSidebarCommunity[]; fetchedAt: number } | null;
  inflight: Promise<void> | null;
} = { data: null, inflight: null };

export const SIDEBAR_STALE_MS = 60_000;

// ─── Where the viewer stands with one community ───────────────────────────────

/**
 * Fired when a community's viewer state moved — a request was filed, withdrawn
 * or accepted, or a fetched answer corrected a stale row.
 *
 * Deliberately NOT SIDEBAR_CHANGED_EVENT: that one means "the membership list is
 * stale, refetch it", and filing a request changes no membership. Surfaces that
 * only render the Explore projection (the Explore page's own list) listen here
 * and re-read the store, so one write updates every one of them.
 */
export const COMMUNITY_VIEWER_STATE_EVENT = "uxcommunity:community-viewer-state";

export interface CommunityViewerState {
  /** The viewer belongs to the community. */
  joined: boolean;
  /** A private community is waiting on the owner's answer. */
  hasPendingRequest?: boolean;
}

/**
 * Applies a viewer state to the cached Explore row, and says whether the row
 * actually moved — so a fetch that merely confirms what the list already said
 * stays silent.
 */
function patchCachedViewerState(
  communityId: string,
  state: CommunityViewerState,
): boolean {
  // Someone who belongs is not waiting for approval, so the two flags are one
  // fact, not two independent toggles.
  const pending = state.joined ? false : Boolean(state.hasPendingRequest);
  const data = exploreStore.data;
  const current = data?.communities.find((c) => c.id === communityId);
  if (!data || !current) return false;
  if (current.joined === state.joined && Boolean(current.has_pending_request) === pending) {
    return false;
  }
  exploreStore.data = {
    ...data,
    communities: data.communities.map((c) =>
      c.id === communityId
        ? { ...c, joined: state.joined, has_pending_request: pending }
        : c,
    ),
  };
  return true;
}

/**
 * The one writer of where the viewer stands with a community.
 *
 * Every surface that shows this fact reads the same cached row: the Explore
 * list, the join dialog (whatever opened it — Explore, the home-feed popup, the
 * Suggested Communities rail), and the Requests tab. So every surface records
 * the outcome HERE and nowhere else: a request filed from the home feed cannot
 * leave Explore offering to request all over again, because there is no second
 * copy to fall out of step.
 *
 * A join is a membership change, so the sidebar projection is dropped exactly as
 * it always was; a request — or a repeat of a state the list already holds —
 * touches only the Explore row.
 */
export function setCommunityViewerState(
  communityId: string,
  state: CommunityViewerState,
): void {
  const moved = patchCachedViewerState(communityId, state);
  if (state.joined) {
    sidebarStore.data     = null;
    sidebarStore.inflight = null;
    invalidateRequest("/api/communities");
    notifySidebarChanged();
  }
  if (moved) notifyViewerStateChanged();
}

/**
 * Reconciles the cached row with an answer a surface just fetched (the
 * community preview endpoint). Nothing is assumed to have changed — the sidebar
 * keeps its list, because a member simply re-reading a community is not a
 * membership change.
 */
export function syncCommunityViewerState(
  communityId: string,
  state: CommunityViewerState,
): void {
  if (patchCachedViewerState(communityId, state)) notifyViewerStateChanged();
}

// ─── Cache-invalidation helpers (join / leave) ────────────────────────────────

/** A join, in the one vocabulary above. Kept for its many callers. */
export function invalidateOnJoin(communityId: string): void {
  setCommunityViewerState(communityId, { joined: true });
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
  syncCommunityViewerState(communityId, { joined: false });
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

/** Hide a community for this user while retaining the membership. */
/**
 * Surgically update fields on a single community in the sidebar store
 * (e.g. name, image_url after saving settings) without busting the whole cache.
 * Fires SIDEBAR_CHANGED_EVENT so the panel re-renders immediately.
 */
export function patchSidebarCommunity(
  communityId: string,
  patch: Partial<
    Pick<
      CachedSidebarCommunity,
      | "name"
      | "image_url"
      | "is_private"
      | "enabled_tabs"
      | "showcase_enabled"
      | "notifications_muted"
      | "notifications_muted_until"
    >
  >,
): void {
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.map((c) =>
        c.id === communityId ? { ...c, ...patch } : c
      ),
    };
    patchCachedRequest<{ communities: CachedSidebarCommunity[] }>(
      "/api/communities",
      (current) => ({
        communities: current.communities.map((community) =>
          community.id === communityId ? { ...community, ...patch } : community
        ),
      }),
    );
  }
  notifySidebarChanged();
}

/**
 * Optimistically updates a community's reaction preview in the shared sidebar
 * cache. The sidebar listens for this event, so chat actions render there in
 * the same frame instead of waiting for the database and Realtime round trip.
 */
export function patchSidebarReaction(
  communityId: string,
  lastReaction: SidebarLastReaction | null,
): void {
  if (lastReaction) {
    clearReactionTombstone(communityId, lastReaction.messageId);
  }
  if (!sidebarStore.data) return;

  const patch = (community: CachedSidebarCommunity) =>
    community.id === communityId ? { ...community, lastReaction } : community;

  sidebarStore.data = {
    ...sidebarStore.data,
    communities: sidebarStore.data.communities.map(patch),
  };
  // Mirror into the request cache so a stale-window replay can't resurrect a
  // pre-reaction preview (same rationale as patchSidebarLastMessage).
  patchCachedRequest<{ communities: CachedSidebarCommunity[] }>(
    "/api/communities",
    (current) => ({
      communities: current.communities.map(patch),
    }),
  );
  notifySidebarReactionChanged();
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

export const SIDEBAR_CHANGED_EVENT = "uxcommunity:sidebar-changed";
/**
 * Fired only for local reaction preview patches. Unlike SIDEBAR_CHANGED_EVENT
 * this must NOT trigger a server refetch: the cached /api/communities snapshot
 * predates the reaction, and reloading it would clobber the optimistic preview
 * (and any newer last_message) with stale rows.
 */
export const SIDEBAR_REACTION_CHANGED_EVENT = "uxcommunity:sidebar-reaction-changed";
/**
 * Fired only for local last-message patches (optimistic sends from the chat
 * window). Same constraints as SIDEBAR_REACTION_CHANGED_EVENT: no server
 * refetch, because the cached /api/communities snapshot predates the send.
 */
export const SIDEBAR_MESSAGE_CHANGED_EVENT = "uxcommunity:sidebar-message-changed";

function notifyViewerStateChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(COMMUNITY_VIEWER_STATE_EVENT));
  }
}

function notifySidebarChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIDEBAR_CHANGED_EVENT));
  }
}

function notifySidebarReactionChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIDEBAR_REACTION_CHANGED_EVENT));
  }
}

function notifySidebarMessageChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIDEBAR_MESSAGE_CHANGED_EVENT));
  }
}

/**
 * Optimistically updates a community's last-message preview in the shared
 * sidebar cache when the current user sends a message, so the community jumps
 * to the top of the list instantly instead of waiting for the Realtime echo
 * (DB insert → fan-out → WebSocket round trip). The Realtime echo, when it
 * arrives, replaces the optimistic preview with the authoritative row.
 *
 * Mirrors the change into the request cache so a sidebar refetch within the
 * stale window can't clobber the optimistic preview with an older snapshot.
 */
export function patchSidebarLastMessage(
  communityId: string,
  lastMessage: CachedSidebarCommunity["last_message"],
): void {
  const patch = (c: CachedSidebarCommunity): CachedSidebarCommunity => ({
    ...c,
    is_archived: false,
    lastReaction: null, // a new message supersedes any pending reaction preview
    last_message: lastMessage,
  });
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.map((c) =>
        c.id === communityId ? patch(c) : c
      ),
    };
  }
  patchCachedRequest<{ communities: CachedSidebarCommunity[] }>(
    "/api/communities",
    (current) => ({
      communities: current.communities.map((community) =>
        community.id === communityId ? patch(community) : community
      ),
    }),
  );
  notifySidebarMessageChanged();
}

/** Updates the sidebar preview when an existing latest message is edited. */
export function patchSidebarMessageContent(
  communityId: string,
  messageId: string,
  content: string,
): void {
  const patch = (community: CachedSidebarCommunity): CachedSidebarCommunity => {
    if (community.last_message?.id !== messageId) return community;
    return {
      ...community,
      last_message: { ...community.last_message, content },
    };
  };

  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.map((community) =>
        community.id === communityId ? patch(community) : community,
      ),
    };
  }
  patchCachedRequest<{ communities: CachedSidebarCommunity[] }>(
    "/api/communities",
    (current) => ({
      communities: current.communities.map((community) =>
        community.id === communityId ? patch(community) : community,
      ),
    }),
  );
  notifySidebarMessageChanged();
}

/**
 * Restores a community's sidebar entry to a previous snapshot — used to roll
 * back an optimistic last-message patch when a send fails (the message never
 * landed, so the preview must not show it).
 */
export function restoreSidebarEntry(
  communityId: string,
  entry: CachedSidebarCommunity,
): void {
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.map((c) =>
        c.id === communityId ? entry : c
      ),
    };
  }
  patchCachedRequest<{ communities: CachedSidebarCommunity[] }>(
    "/api/communities",
    (current) => ({
      communities: current.communities.map((community) =>
        community.id === communityId ? entry : community
      ),
    }),
  );
  notifySidebarMessageChanged();
}
