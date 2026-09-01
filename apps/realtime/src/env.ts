export interface Env {
  /** Community-scoped Durable Objects (chat:${communityId}, etc.) */
  COMMUNITY_DO: DurableObjectNamespace;
  /** User-scoped Durable Objects (user:${userId}) */
  USER_DO: DurableObjectNamespace;
  SESSION_SECRET: string;
  REALTIME_PUBLISH_SECRET: string;
  /** Internal API URL for membership checks. */
  API_URL: string;
  /** Internal API secret for membership checks. */
  API_SECRET: string;
}
