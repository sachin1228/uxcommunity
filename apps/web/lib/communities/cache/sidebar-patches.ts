import { patchCachedRequest } from "@/lib/request-cache";
import type { CachedSidebarCommunity, SidebarLastReaction } from "./types";
import {
  notifySidebarChanged,
  notifySidebarMessageChanged,
  notifySidebarReactionChanged,
} from "./events";
import { clearSidebarReactionTombstone } from "./reaction-tombstones";
import { sidebarStore } from "./stores";

/**
 * Surgically update fields on a single community in the sidebar store
 * (e.g. name, image_url after saving settings) without busting the whole cache.
 * Fires SIDEBAR_CHANGED_EVENT so the panel re-renders immediately.
 */
export function patchSidebarCommunity(
  communityId: string,
  patch: Partial<Pick<CachedSidebarCommunity, "name" | "image_url" | "is_private" | "enabled_tabs" | "showcase_enabled">>,
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
    clearSidebarReactionTombstone(communityId, lastReaction.messageId);
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
