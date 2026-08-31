/**
 * Realtime room name helpers — client-safe (no server-only imports).
 * Kept separate from lib/realtime/publish.ts so Client Components can derive
 * room names without pulling in the server-only publish helper.
 */
export const realtimeRooms = {
  chat: (communityId: string) => `chat:${communityId}`,
  presence: (communityId: string) => `presence:${communityId}`,
  typing: (communityId: string) => `typing:${communityId}`,
  /** @deprecated Panel rooms are no longer used. Sidebar state is derived from chat events. */
  panel: (userId: string) => `panel:${userId}`,
  profile: (userId: string) => `profile:${userId}`,
  notifications: (userId: string) => `notifications:${userId}`,
  threads: (communityId: string) => `threads:${communityId}`,
  threadComments: (threadId: string) => `thread-comments:${threadId}`,
  events: (communityId: string) => `events:${communityId}`,
  resources: (communityId: string) => `resources:${communityId}`,
  resourceComments: (resourceId: string) => `resource-comments:${resourceId}`,
  showcase: (postId: string) => `showcase:${postId}`,
  rules: (communityId: string) => `rules:${communityId}`,
  /** 3D designer studio — one shared room for everyone. */
  designers: () => "designers-studio",
} as const;
