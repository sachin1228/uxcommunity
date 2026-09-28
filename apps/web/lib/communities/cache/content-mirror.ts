/**
 * The in-app mirror for content items the current user just created or deleted.
 *
 * WHY THIS EXISTS
 *   When the user creates a thread/showcase post/resource/event from a tab, the
 *   mounted chat timeline has to add its permanent "You created a …" card in the
 *   same frame — without waiting for the realtime round trip, and without the two
 *   views knowing about each other. This is that channel, and its payload mirrors
 *   the realtime `content-insert` / `content-delete` topics so the timeline treats
 *   both paths identically (idempotent by item id).
 *
 *   It is not cache state: it is a notification of a mutation, which is why it is
 *   not with the stores.
 */

import type { ContentEventKind } from "./types";
import type { ContentEventMeta } from "../content-notifications";

export const CONTENT_EVENT_CHANGED_EVENT = "uxcommunity:content-event-changed";

/**
 * Fired when the current user creates or deletes a thread/showcase post/
 * resource/event so the mounted chat timeline can add or remove its permanent
 * "You created a …" card in the same frame. Payload mirrors the realtime
 * `content-insert` / `content-delete` topics, so the timeline treats both
 * paths identically (idempotent by item id).
 */
export function notifyContentEvent(
  detail:
    | { kind: "insert"; event: { id: string; community_id: string; user_id: string; kind: ContentEventKind; title: string; created_at: string; meta?: ContentEventMeta | null } }
    | { kind: "delete"; event: { id: string; community_id: string; kind: ContentEventKind } },
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONTENT_EVENT_CHANGED_EVENT, { detail }));
}
