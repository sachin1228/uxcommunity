/**
 * Tiny module-level store for tracking which community is currently open.
 * Mirrors web's activeCommunityIdRef in useSidebarCommunities.
 * Used by useCommunities (to skip unread increment) and the chat screen (to set/clear).
 */
export const communityStore = {
  activeCommunityId: null as string | null,
};
