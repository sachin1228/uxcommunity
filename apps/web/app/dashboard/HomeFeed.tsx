"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { CommunityFeedList } from "@/components/feeds/CommunityFeedList";
import { FeedLoadMore } from "@/components/feeds/FeedLoadMore";
import { CommunityPreviewModal } from "@/components/communities/CommunityPreviewModal";
import { FEED_PAGE_SIZE, feedItemKind, type FeedItem } from "@/components/feeds/types";
import { Spinner } from "@/components/ui/Spinner";
import { fetchJsonCached, getCachedRequest, initRequestCache, invalidateRequest, patchCachedRequest, setCachedRequest } from "@/lib/request-cache";
import { afterDashboardPaint, markDashboardPaint } from "@/lib/login-performance";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import { applyContentChanges } from "@/lib/communities/content-sync";
import { useContentChanges } from "@/lib/communities/use-content-changes";
import { type HomeFeedFilterScope, HOME_FEED_RECLICK_TOPIC } from "@/lib/feeds/home-feed-options";
import { RECLICK_REFRESH_EVENT, type ReclickRefreshDetail } from "@/lib/navigation-guard";

interface HomeFeedProps {
  currentUserId: string;
  refreshToken?: number;
  /** Feed source — the unified default or joined communities only. */
  scope: HomeFeedFilterScope;
  initialItems?: FeedItem[];
}

/** Empty-state copy per feed source — the filters partition the same cards. */
const EMPTY_STATE_DESCRIPTION: Record<HomeFeedFilterScope, string> = {
  all: "Posts from your communities and public posts from across the community will appear here.",
  communities:
    "Everything posted in the communities you've joined will appear here, whether or not it was shared publicly.",
};

/**
 * The homepage feed: fetches and paginates the cross-community card page, then
 * hands it to the shared CommunityFeedList, which renders the same cards (and
 * the same mutations) as the profile activity tabs.
 */
export function HomeFeed({ currentUserId, refreshToken = 0, scope, initialItems }: HomeFeedProps) {
  const bootstrap = useRef(initialItems);
  initRequestCache(currentUserId);
  const feedUrl = `/api/home/feed?scope=${encodeURIComponent(scope)}`;

  // Peek the cache for this scope so a remount (first visit included) can render
  // straight from the request cache when it has one; otherwise the standard
  // loader shows until the fetch lands.
  const cached = getCachedRequest<{ items?: FeedItem[] }>(feedUrl, currentUserId);
  const cachedItems = Array.isArray(cached?.items) ? cached.items : initialItems;
  const [items, setItems] = useState<FeedItem[]>(() => cachedItems ?? []);
  const [loading, setLoading] = useState(() => !cachedItems);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(() => (cachedItems?.length ?? 0) >= FEED_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Non-member community preview popup, opened from a card's "posted in …" label. */
  const [previewCommunityId, setPreviewCommunityId] = useState<string | null>(null);

  const fetchFeed = useCallback(async (background = false, force = false) => {
    if (!background) setLoading(true);
    try {
      const data = await fetchJsonCached<{ items?: FeedItem[] }>(
        feedUrl,
        { staleMs: 30_000, force },
        currentUserId,
      );
      if (!Array.isArray(data?.items)) {
        invalidateRequest(feedUrl, currentUserId);
        throw new Error("The feed response was incomplete. Please try again.");
      }
      setItems(data.items);
      setHasMore(data.items.length >= FEED_PAGE_SIZE);
      setError(null);
    } catch (fetchError: unknown) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load the feed.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, feedUrl]);

  useEffect(() => {
    const initial = bootstrap.current;
    bootstrap.current = undefined;
    if (initial && refreshToken === 0 && !getCachedRequest(feedUrl, currentUserId)) {
      setCachedRequest(feedUrl, { items: initial }, currentUserId);
    }
    const initialFetch = window.setTimeout(() => void fetchFeed(true, refreshToken > 0), 0);
    return () => {
      window.clearTimeout(initialFetch);
    };
  }, [fetchFeed, refreshToken, feedUrl, currentUserId]);

  useEffect(() => {
    if (!loading && !error) return afterDashboardPaint(() => markDashboardPaint("feed"));
  }, [loading, error]);

  // Refetch when returning after a real absence (no realtime subscription keeps
  // the feed current); brief alt-tabs no longer fire a request each.
  useHiddenCatchUp(() => void fetchFeed(true));

  // Re-clicking the Feed link refetches only this list; the app shell and the
  // sidebar stay mounted (the guard drops same-route transitions).
  useEffect(() => {
    function onReclickRefresh(event: Event) {
      const topic = (event as CustomEvent<ReclickRefreshDetail>).detail?.topic;
      if (topic === HOME_FEED_RECLICK_TOPIC) void fetchFeed(true, true);
    }
    window.addEventListener(RECLICK_REFRESH_EVENT, onReclickRefresh);
    return () => window.removeEventListener(RECLICK_REFRESH_EVENT, onReclickRefresh);
  }, [fetchFeed]);

  /**
   * Card mutations are local-first: the list has already patched itself, so this
   * only mirrors the same update into the shared request cache.
   */
  const updateItems = useCallback((update: (current: FeedItem[]) => FeedItem[]) => {
    setItems((current) => {
      const next = update(current);
      patchCachedRequest<{ items?: FeedItem[] }>(
        feedUrl,
        (cachedFeed) => ({ ...cachedFeed, items: next }),
        currentUserId,
      );
      return next;
    });
  }, [currentUserId, feedUrl]);

  // Mutations made in a community tab, in the profile tabs or on a card detail
  // page (including the ones queued while this feed was unmounted) are merged
  // into the already-loaded page — no refetch, no divergence.
  useContentChanges(null, useCallback((changes) => {
    updateItems((current) => applyContentChanges(current, changes, feedItemKind));
  }, [updateItems]));

  // ── Load older posts (keyset pagination via ?before=created_at) ──────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !items.length) return;
    const last = items[items.length - 1];
    setLoadingMore(true);
    try {
      const response = await fetch(
        `${feedUrl}&before=${encodeURIComponent(last.created_at)}`,
      );
      if (!response.ok) return;
      const data = await response.json() as { items?: FeedItem[] };
      if (!Array.isArray(data?.items)) return;
      const incoming = data.items;
      updateItems((prev) => {
        const ids = new Set(prev.map((item) => item.id));
        return [...prev, ...incoming.filter((item) => !ids.has(item.id))];
      });
      setHasMore(incoming.length >= FEED_PAGE_SIZE);
    } catch {
      // Network error — leave the feed as-is.
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore, updateItems, feedUrl]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" role="status" aria-label="Loading feed">
        <Spinner size={28} />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <p className="font-body text-sm font-medium text-red-400">Couldn&apos;t load your feed</p>
        <p className="max-w-sm font-body text-xs text-foreground-subtle">{error}</p>
        <button
          type="button"
          onClick={() => void fetchFeed(false, true)}
          className="mt-2 rounded-full border border-border px-4 py-2 font-body text-xs font-medium text-foreground hover:bg-background-subtle"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      {previewCommunityId && (
        <CommunityPreviewModal
          communityId={previewCommunityId}
          onClose={() => setPreviewCommunityId(null)}
        />
      )}
      <CommunityFeedList
        items={items}
        currentUserId={currentUserId}
        onChange={updateItems}
        onOpenCommunityPreview={setPreviewCommunityId}
        showEventChat
        emptyState={(
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="font-body text-sm font-medium text-foreground-muted">No posts yet</p>
            <p className="mt-1 max-w-xs font-body text-xs text-foreground-subtle">
              {EMPTY_STATE_DESCRIPTION[scope]}
            </p>
          </div>
        )}
      />

      <FeedLoadMore hasMore={hasMore} loading={loadingMore} onLoadMore={loadMore} />
    </>
  );
}
