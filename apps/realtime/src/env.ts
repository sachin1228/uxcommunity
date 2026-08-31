export interface Env {
  /** Community-scoped Durable Objects (chat:${communityId}, etc.) */
  COMMUNITY_DO: DurableObjectNamespace;
  /** User-scoped Durable Objects (user:${userId}) — the WebSocket gateway */
  USER_DO: DurableObjectNamespace;
  SESSION_SECRET: string;
  REALTIME_PUBLISH_SECRET: string;
}
