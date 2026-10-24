/**
 * Home feed — the cross-community card page behind the web dashboard home.
 *
 * `/api/home/feed?scope=…` returns the cards the member may see for one feed
 * source (see ./homeFeedScope): threads, events, resources and showcase from
 * any community, each tagged with `_type` plus the community it came from.
 * Pagination is keyset: `?before=<created_at>` with a page size of 12.
 *
 * Feed items are the same card shapes the community tabs use, so both surfaces
 * render the one shared card component.
 */

import { Image } from 'expo-image';
import { apiFetch } from './api';
import type { CommunityContent, ContentKind } from './communityContent';
import type { HomeFeedScope } from './homeFeedScope';

/**
 * Matches the server's FEED_PAGE_SIZE. Small on purpose: a page is a render
 * budget, not a scroll limit — the list asks for the next page as the reader
 * approaches the end. 12 keeps the first paint to the handful of cards a
 * phone viewport actually shows instead of mounting 30 heavy cards at once.
 */
export const HOME_FEED_PAGE_SIZE = 12;

/**
 * Shared FlatList budget for the card feeds. RN's defaults (10 initial, 10 per
 * batch, windowSize 21) mount roughly a screen and a half of heavy cards up
 * front and keep ~10 screens of them alive; these values keep the initial
 * paint to one viewport and the mounted window to a few screens.
 */
export const FEED_LIST_PERFORMANCE = {
  initialNumToRender: 4,
  maxToRenderPerBatch: 4,
  windowSize: 7,
  updateCellsBatchingPeriod: 50,
} as const;

/**
 * The chat equivalent. Bubbles are lighter than cards, so a screenful and a
 * bit is safe up front; the mounted window stays a few screens instead of RN's
 * default ten.
 */
export const CHAT_LIST_PERFORMANCE = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 8,
  windowSize: 11,
  updateCellsBatchingPeriod: 50,
} as const;

/** Only the first few images are worth warming before they scroll in. */
const FEED_PREFETCH_LIMIT = 3;

/**
 * Warm the memory/disk cache for the first few images in a fresh page. The
 * list renders four cards initially, so prefetching every attachment would
 * compete with the images the member can already see; three covers the next
 * card or two without turning a feed load into a bulk download.
 */
export function prefetchFeedImages(items: FeedItem[]): void {
  const urls: string[] = [];
  for (const item of items) {
    if (urls.length >= FEED_PREFETCH_LIMIT) break;
    if (item._type === 'thread' || item._type === 'showcase') {
      const attachments = (item as { attachments?: Array<{ url: string; type?: string }> }).attachments;
      for (const attachment of attachments ?? []) {
        if (attachment.type?.startsWith('image/')) urls.push(attachment.url);
        if (urls.length >= FEED_PREFETCH_LIMIT) break;
      }
    } else if (item._type === 'event') {
      const cover = (item as { cover_image_url?: string | null }).cover_image_url;
      if (cover) urls.push(cover);
    }
  }
  if (urls.length) {
    void Image.prefetch(urls, 'memory-disk');
  }
}

export type FeedItemType = 'thread' | 'event' | 'resource' | 'showcase';

export type FeedItem = CommunityContent & {
  _type: FeedItemType;
  community_name?: string | null;
  community_image?: string | null;
};

/** `_type` is the singular discriminator; the card wants the plural kind. */
const KIND_BY_TYPE: Record<FeedItemType, ContentKind> = {
  thread: 'threads',
  event: 'events',
  resource: 'resources',
  showcase: 'showcase',
};

export function feedItemKind(item: FeedItem): ContentKind {
  return KIND_BY_TYPE[item._type] ?? 'threads';
}

export interface HomeFeedPage {
  items: FeedItem[];
  hasMore: boolean;
}

export async function getHomeFeed(
  scope: HomeFeedScope,
  before?: string,
): Promise<HomeFeedPage> {
  const params = new URLSearchParams({ scope });
  if (before) params.set('before', before);
  const { data } = await apiFetch<{ items?: unknown[] }>(
    `/api/home/feed?${params.toString()}`,
  );
  const items = (data.items ?? []) as FeedItem[];
  return { items, hasMore: items.length >= HOME_FEED_PAGE_SIZE };
}

/** Stable list key — ids are unique per table, but not across the four. */
export function feedItemKey(item: FeedItem): string {
  return `${item._type}:${item.id}`;
}
