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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';
import type { CommunityContent, ContentKind } from './communityContent';
import {
  HOME_FEED_SCOPE_STORAGE_KEY,
  normalizeStoredHomeFeedScope,
  type HomeFeedTabScope,
} from './homeFeedScopes';

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

/**
 * One page of the home feed. `scope` picks the tab ("Your Communities" /
 * "Public Posts" — disjoint); omitting it would fall back to the server's
 * legacy `all`, which mobile never shows.
 */
export async function getHomeFeed(
  before?: string,
  scope: HomeFeedTabScope = 'public',
): Promise<HomeFeedPage> {
  const params = new URLSearchParams({ scope });
  if (before) params.set('before', before);
  const { data } = await apiFetch<{ items?: unknown[] }>(`/api/home/feed?${params.toString()}`);
  const items = (data.items ?? []) as FeedItem[];
  return { items, hasMore: items.length >= HOME_FEED_PAGE_SIZE };
}

/**
 * The Saved tab — `GET /api/profile/feed?scope=saved`, which returns the same
 * card payloads as the home feed (threads/showcase/events by their saves,
 * resources by their bookmarks; the heart on a resource is a *like* and never
 * lands here).
 */
export async function getSavedFeed(before?: string): Promise<HomeFeedPage> {
  const query = before ? `&before=${encodeURIComponent(before)}` : '';
  const { data } = await apiFetch<{ items?: unknown[] }>(
    `/api/profile/feed?scope=saved${query}`,
  );
  const items = (data.items ?? []) as FeedItem[];
  return { items, hasMore: items.length >= HOME_FEED_PAGE_SIZE };
}

/** The member's stored scope choice (legacy `all` reads as `public`). */
export async function readStoredHomeFeedScope(): Promise<HomeFeedTabScope> {
  try {
    return normalizeStoredHomeFeedScope(await AsyncStorage.getItem(HOME_FEED_SCOPE_STORAGE_KEY));
  } catch {
    return 'public';
  }
}

export async function storeHomeFeedScope(scope: HomeFeedTabScope): Promise<void> {
  try {
    await AsyncStorage.setItem(HOME_FEED_SCOPE_STORAGE_KEY, scope);
  } catch {
    // Storage unavailable — the choice just won't persist.
  }
}

/** Stable list key — ids are unique per table, but not across the four. */
export function feedItemKey(item: FeedItem): string {
  return `${item._type}:${item.id}`;
}
