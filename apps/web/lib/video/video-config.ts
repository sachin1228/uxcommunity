/**
 * Video encoder/safety configuration — single source of truth lives in
 * `@uxcommunity/shared` (packages/shared/src/video/video-config.ts) so the
 * web app (client worker) and the server-side transcoder service can never
 * drift apart. Re-exported here for the app's existing import surface.
 */
export * from "@uxcommunity/shared";