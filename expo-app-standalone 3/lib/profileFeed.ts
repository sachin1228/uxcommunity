/**
 * The Profile screen's activity tabs — one keyset-paged card list per scope.
 *
 * `/api/profile/feed?scope=…` returns the same card payloads as
 * `/api/home/feed` (one projection, one shared card component), listing the
 * scopes the member authored; `saved` lists what they saved. Pagination is
 * keyset: `?before=<created_at>` with the same page size as the home feed.
 */

import { apiFetch } from './api';
import type { FeedItem } from './homeFeed';
import { HOME_FEED_PAGE_SIZE } from './homeFeed';

/** Every tab the profile feed serves, in the order the rail shows them. */
export const PROFILE_FEED_SCOPES = ['all', 'thread', 'showcase', 'resource', 'event', 'saved'] as const;

export type ProfileFeedScope = (typeof PROFILE_FEED_SCOPES)[number];

export interface ProfileFeedPage {
  items: FeedItem[];
  hasMore: boolean;
}

export async function getProfileFeed(
  scope: ProfileFeedScope,
  before?: string,
): Promise<ProfileFeedPage> {
  const params = new URLSearchParams({ scope });
  if (before) params.set('before', before);
  const { data } = await apiFetch<{ items?: unknown[] }>(`/api/profile/feed?${params.toString()}`);
  const items = (data.items ?? []) as FeedItem[];
  return { items, hasMore: items.length >= HOME_FEED_PAGE_SIZE };
}
