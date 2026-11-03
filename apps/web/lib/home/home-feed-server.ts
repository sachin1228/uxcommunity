import "server-only";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc, type Json } from "@/lib/supabase/performance-rpcs";
import { HOME_FEED_TAG } from "@/lib/home-feed-cache";
import type { HomeFeedScope } from "@/lib/feeds/home-feed-options";
import { attachPollVotes } from "@/lib/threads/poll-votes";
import { loadEventAttendeePreviews, loadEventChatCardLinks } from "@/lib/communities/event-cards";
import { FEED_PAGE_SIZE as PAGE_SIZE, isFeedCard, normalizeFeedCard, type FeedCardObject } from "@/lib/feeds/feed-items";

// The home feed is read by every user on every dashboard visit. Recomputing it
// per request runs ~12 × ~6 correlated count subqueries in get_home_feed_page,
// which is heavy for the free-tier micro compute and the 5GB egress budget.
// unstable_cache dedupes identical (user, cursor) reads for 10s, collapsing N
// concurrent page loads into a single DB round-trip. 10s is short enough that
// new posts / own likes appear almost immediately.
export const loadHomeFeedPage = unstable_cache(
  async (userId: string, before: string | null, scope: HomeFeedScope) => {
    const db = createServiceClient();
    const { data, error } = await callPerformanceRpc(
      db,
      "get_home_feed_page",
      {
        p_user_id: userId,
        p_before: before,
        p_limit: PAGE_SIZE,
        p_scope: scope,
      },
    );
    if (error) throw error;

    // Keep this boundary defensive while older databases still have the
    // pre-simplification mixed-content RPC installed. Community-public cards
    // remain part of the homepage, while old standalone event/resource/
    // showcase records are intentionally left out.
    let items = (data ?? [])
      .map(({ item }) => item)
      .filter(isFeedCard)
      .map(normalizeFeedCard);

    // Attach poll vote totals so feed thread cards show live counts, and load
    // the event extras for the same page. Nothing here depends on anything
    // else — issue all of it together so the page costs one round trip after
    // the RPC instead of stacking the poll reads behind the event reads.
    const threadObjects = items.filter((item): item is FeedCardObject =>
      isFeedCard(item) && item._type === "thread",
    );
    const eventIds = items.flatMap((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        && item._type === "event" && typeof item.id === "string"
        ? [item.id]
        : [],
    );

    const [attached, eventBatches] = await Promise.all([
      threadObjects.length
        ? attachPollVotes(
            db,
            threadObjects as unknown as Array<Record<string, unknown>>,
            userId,
          )
        : Promise.resolve(null),
      eventIds.length
        ? // Same attendee previews every other event surface uses, and the room
          // behind each event — when one exists — for the card's Join/Open row
          // (see EventChatPanel). Both are batched reads for the whole page.
          Promise.all([
            loadEventAttendeePreviews(eventIds),
            loadEventChatCardLinks(eventIds, userId),
          ])
        : Promise.resolve(null),
    ]);

    if (attached) {
      const byId = new Map<string, FeedCardObject>();
      for (const row of attached) {
        if (typeof row.id === "string") byId.set(row.id, row as unknown as FeedCardObject);
      }
      items = items.map((item) =>
        isFeedCard(item) && item._type === "thread" && typeof item.id === "string" && byId.has(item.id)
          ? byId.get(item.id)!
          : item,
      );
    }

    if (!eventBatches) return items;
    const [previewMap, chatLinks] = eventBatches;

    return items.map((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        && item._type === "event" && typeof item.id === "string"
        ? {
            ...item,
            rsvps: (previewMap.get(item.id) ?? []) as unknown as Json,
            chat_community: chatLinks.get(item.id) ?? null,
          }
        : item,
    );
  },
  ["home-feed", HOME_FEED_TAG],
  { revalidate: 10, tags: [HOME_FEED_TAG] },
);
