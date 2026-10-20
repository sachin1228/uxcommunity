/**
 * Realtime room name helpers — client-safe (no server-only imports).
 * Kept separate from lib/realtime/publish.ts so Client Components can derive
 * room names without pulling in the server-only publish helper.
 */
export const realtimeRooms = {
  chat: (communityId: string) => `chat:${communityId}`,
  presence: (communityId: string) => `presence:${communityId}`,
  notifications: (userId: string) => `notifications:${userId}`,
  /** Direct messages — ONE logical room per user; every conversation
   *  multiplexes over it (see apps/realtime room-routing). */
  dm: (userId: string) => `dm:${userId}`,
  threads: (communityId: string) => `threads:${communityId}`,
  threadComments: (threadId: string) => `thread-comments:${threadId}`,
  events: (communityId: string) => `events:${communityId}`,
  resources: (communityId: string) => `resources:${communityId}`,
  resourceComments: (resourceId: string) => `resource-comments:${resourceId}`,
  /**
   * Showcase comments are scoped to the community *and* the post: the Room DO
   * authorizes a socket by the community segment, and the post segment keeps
   * one post's comment traffic isolated from another's.
   */
  showcase: (communityId: string, postId: string) => `showcase:${communityId}:${postId}`,
  rules: (communityId: string) => `rules:${communityId}`,
} as const;
