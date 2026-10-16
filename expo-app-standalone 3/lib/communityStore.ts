/**
 * Tiny module-level store for tracking which community is currently open,
 * plus a change channel from other screens back to the communities list.
 * Mirrors web's activeCommunityIdRef in useSidebarCommunities.
 *
 * Used by useCommunities (to skip unread increment, and to apply what other
 * screens changed) and by the screens themselves (the chat header's mute /
 * leave / delete, and the create flow's brand-new community).
 */

import type { Community } from '@/lib/communities';

/** Fields a chat screen may patch onto the list's copy of a community. */
export type CommunityRowPatch = Partial<
  Pick<Community, 'notifications_muted' | 'notifications_muted_until' | 'is_archived'>
>;

export type CommunityChange =
  /** Patch one row in place (mute state, archive). */
  | { kind: 'patch'; communityId: string; patch: CommunityRowPatch }
  /** Drop the row entirely (Exit community). */
  | { kind: 'remove'; communityId: string }
  /** The list itself is stale (a community was just created) — re-read. */
  | { kind: 'refresh' };

type Listener = (change: CommunityChange) => void;

const listeners = new Set<Listener>();

export const communityStore = {
  activeCommunityId: null as string | null,

  /**
   * Tell the communities list what changed. The chat header's mute saves,
   * "Delete chat" (archive), "Exit community" (leave) and the create flow's
   * new community all happen elsewhere, but the list they affect lives here —
   * patching it in place keeps the list truthful without a refetch.
   */
  notifyCommunityChanged(change: CommunityChange) {
    for (const listener of listeners) listener(change);
  },

  /** Subscribe to list changes; returns the unsubscribe. */
  subscribeCommunityChanges(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
