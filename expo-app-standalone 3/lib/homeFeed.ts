/**
 * Home feed — the cross-community card page behind the web dashboard home.
 *
 * `/api/home/feed` returns every community card the member may see (threads,
 * events, resources and showcase from any community), each tagged with `_type`
 * plus the community it came from. Pagination is keyset: `?before=<created_at>`
 * with a page size of 30.
 *
 * Feed items are the same card shapes the community tabs use, so both surfaces
 * render the one shared card component.
 */

import { apiFetch } from './api';
import type { CommunityContent, ContentKind } from './communityContent';

/** Matches the server's FEED_PAGE_SIZE. */
export const HOME_FEED_PAGE_SIZE = 30;

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

export async function getHomeFeed(before?: string): Promise<HomeFeedPage> {
  const query = before ? `?before=${encodeURIComponent(before)}` : '';
  const { data } = await apiFetch<{ items?: unknown[] }>(`/api/home/feed${query}`);
  const items = (data.items ?? []) as FeedItem[];
  return { items, hasMore: items.length >= HOME_FEED_PAGE_SIZE };
}

/** Stable list key — ids are unique per table, but not across the four. */
export function feedItemKey(item: FeedItem): string {
  return `${item._type}:${item.id}`;
}
