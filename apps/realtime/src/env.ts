export interface Env {
  /** Community-scoped Durable Objects (chat:${communityId}, etc.) */
  COMMUNITY_DO: DurableObjectNamespace;
  /** User-scoped Durable Objects (user:${userId}) */
  USER_DO: DurableObjectNamespace;
  /**
   * The single dependency monitor the cron trigger drives (see alert-monitor.ts).
   * Its state lives in the object's storage, so "we already told them" survives
   * redeploys and cold isolates.
   */
  ALERT_MONITOR: DurableObjectNamespace;
  SESSION_SECRET: string;
  REALTIME_PUBLISH_SECRET: string;
  /** Internal API URL for membership checks. */
  API_URL: string;
  /** Internal API secret for membership checks. */
  API_SECRET: string;
}
