/**
 * Encoding strategy decision — lives in `@uxcommunity/shared`
 * (packages/shared/src/video/video-decision.ts) so the browser and the
 * server-side transcoder decide identically (passthrough / remux /
 * transcode). Re-exported here for the app's existing import surface.
 */
export * from "@uxcommunity/shared";