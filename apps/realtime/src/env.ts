export interface Env {
  /** Community-scoped Durable Objects (chat:${communityId}, etc.) */
  COMMUNITY_DO: DurableObjectNamespace;
  /** User-scoped Durable Objects (user:${userId}) — the WebSocket gateway */
  USER_DO: DurableObjectNamespace;
  SESSION_SECRET: string;
  REALTIME_PUBLISH_SECRET: string;
  /** Defense-in-depth secret for DO-to-DO RPC calls. */
  RPC_SECRET: string;
  /** Internal API URL for membership checks. */
  API_URL: string;
  /** Internal API secret for membership checks. */
  API_SECRET: string;
  /** Feature flag: "true" enables WebSocket ownership (CommunityDO owns connections). */
  USE_WEBSOCKET_OWNERSHIP: string;
}
