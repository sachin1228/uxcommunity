/**
 * Tiny module-level store for tracking which community is currently open,
 * plus a change channel from the chat screen back to the communities list.
 * Mirrors web's activeCommunityIdRef in useSidebarCommunities.
 *
 * Used by useCommunities (to skip unread increment, and to apply what the
 * chat screen changed) and the chat screen (to set/clear, and to patch).
 */

import type { Community } from '@/lib/communities';

/** Fields a chat screen may patch onto the list's copy of a community. */
export type CommunityRowPatch = Partial<
  Pick<Community, 'notifications_muted' | 'notifications_muted_until' | 'is_archived'>
>;

/** `'remove'` drops the row entirely (Exit community). */
export type CommunityRowChange = { communityId: string; patch: CommunityRowPatch | 'remove' };

type Listener = (change: CommunityRowChange) => void;

const listeners = new Set<Listener>();

export const communityStore = {
  activeCommunityId: null as string | null,

  /**
   * Tell the communities list what changed for one community. The chat
   * header's mute saves, "Delete chat" (archive) and "Exit community"
   * (leave) all happen on the chat screen, but the row they affect lives in
   * the list's state — patching it here keeps the list truthful without a
   * refetch, exactly like the web sidebar's cache patches.
   */
  notifyCommunityChanged(change: CommunityRowChange) {
    for (const listener of listeners) listener(change);
  },

  /** Subscribe to row changes; returns the unsubscribe. */
  subscribeCommunityChanges(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
