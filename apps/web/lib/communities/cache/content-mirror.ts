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
 *   It is primarily a notification of a mutation; the one piece of cache state it
 *   touches is the bootstrap's content-event list (see patchCachedBootstrap), so
 *   a chat that mounts after the mutation still sees the card.
 */

import type { CachedContentEvent, ContentEventKind } from "./types";
import type { ContentEventMeta } from "../content-notifications";
import { patchCachedRequest } from "@/lib/request-cache";
import { metaCache } from "./community-cache";

export const CONTENT_EVENT_CHANGED_EVENT = "uxcommunity:content-event-changed";

type CachedBootstrapShape = {
  "content-events"?: { events?: CachedContentEvent[] };
};

/** The creator's display identity, read from the community meta cache. */
function cachedAuthor(communityId: string, userId: string) {
  return (
    metaCache
      .get(communityId)
      ?.members.find((member) => member.user_id === userId)?.users ?? null
  );
}

/**
 * Keep the cached bootstrap's "created a …" cards in step with a local
 * create/delete.
 *
 * WHY THIS EXISTS
 *   The mounted timeline hears the mirror event; a chat that mounts later
 *   reads the cached bootstrap, which is served for 15 minutes. Without this
 *   patch, creating content while the chat is not on screen and then opening
 *   it inside that window misses the card until the cache expires. An unknown
 *   community is left alone — its first fetch answers fresh.
 */
function patchCachedBootstrap(detail: Parameters<typeof notifyContentEvent>[0]): void {
  const communityId = detail.event.community_id;
  const userId = detail.kind === "insert" ? detail.event.user_id : undefined;

  patchCachedRequest<CachedBootstrapShape>(
    `/api/communities/${communityId}/bootstrap`,
    (current) => {
      const section = current["content-events"] ?? {};
      const events = section.events ?? [];
      let next: CachedContentEvent[];
      if (detail.kind === "delete") {
        next = events.filter((event) => event.id !== detail.event.id);
      } else if (events.some((event) => event.id === detail.event.id)) {
        next = events;
      } else {
        next = [
          ...events,
          {
            id: detail.event.id,
            community_id: communityId,
            user_id: detail.event.user_id,
            kind: detail.event.kind,
            title: detail.event.title,
            created_at: detail.event.created_at,
            meta: detail.event.meta ?? null,
            reactions: [],
            users: cachedAuthor(communityId, detail.event.user_id),
          },
        ].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      }
      return { ...current, "content-events": { ...section, events: next } };
    },
    userId,
  );
}

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
  patchCachedBootstrap(detail);
  window.dispatchEvent(new CustomEvent(CONTENT_EVENT_CHANGED_EVENT, { detail }));
}
