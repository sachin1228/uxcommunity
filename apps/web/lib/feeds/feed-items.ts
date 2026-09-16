import type { Json } from "@/lib/supabase/performance-rpcs";

/**
 * The card payload every feed RPC returns (`get_home_feed_page` and
 * `get_profile_feed_page`). Both surfaces render the same client components, so
 * the guard, the defaults and the page size live here — a change to the feed
 * contract can never apply to only one of them.
 */
export const FEED_PAGE_SIZE = 30;

export type FeedCardObject = { [key: string]: Json | undefined };

export function isFeedCard(item: Json): item is FeedCardObject {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
  const kind = item._type;
  return (kind === "thread" || kind === "event" || kind === "resource" || kind === "showcase")
    && item.community_id !== null && item.community_id !== undefined;
}

export function normalizeFeedCard(item: FeedCardObject): Json {
  return {
    ...item,
    ...(item._type === "thread" ? {
      attachments: Array.isArray(item.attachments) ? item.attachments : [],
      links: Array.isArray(item.links) ? item.links : [],
      tags: Array.isArray(item.tags) ? item.tags : [],
    } : {}),
  };
}
