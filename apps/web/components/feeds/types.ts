import type { CommunityThread } from "@/components/communities/threads/types";
import type { CommunityEvent, EventRsvp } from "@/components/communities/events/types";
import type { CommunityResource } from "@/components/communities/resources/types";
import type { ShowcasePost } from "@/components/communities/showcase/types";
import type { ContentKind } from "@/lib/communities/content-sync";

/**
 * The card payloads returned by both feed routes (`/api/home/feed` and
 * `/api/profile/feed`). They are the community card shapes plus the community
 * the post lives in, discriminated by `_type` — which is also the card kind the
 * content-sync bus uses.
 */
export type FeedThread = Omit<CommunityThread, "community_id"> & { _type: "thread"; community_id: string | null; community_name: string | null; community_image: string | null };
export type FeedEvent = Omit<CommunityEvent, "community_id"> & { _type: "event"; community_id: string | null; community_name: string | null; community_image: string | null; rsvps?: EventRsvp[] };
export type FeedResource = Omit<CommunityResource, "community_id"> & { _type: "resource"; community_id: string | null; community_name: string | null; community_image: string | null };
export type FeedShowcase = Omit<ShowcasePost, "community_id"> & { _type: "showcase"; community_id: string | null; community_name: string | null; community_image: string | null };
export type FeedItem = FeedThread | FeedEvent | FeedResource | FeedShowcase;

export { FEED_PAGE_SIZE } from "@/lib/feeds/feed-items";

/** Card kind of a feed item — the discriminator the sync bus matches on. */
export function feedItemKind(item: FeedItem): ContentKind {
  return item._type;
}

/**
 * Wrapper every feed puts around a card so the card's own border/rounding is
 * replaced by the feed row's. One definition keeps the homepage feed and the
 * profile tabs pixel-identical.
 */
export const feedCardWrapperClassName =
  "relative z-0 overflow-hidden rounded-xl border border-border bg-background-subtle [&>article]:border-0 [&>article]:rounded-none [&>div>article]:border-0 [&>div>article]:rounded-none";
