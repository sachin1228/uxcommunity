"use client";

import { useEffect, useState, useCallback } from "react";
import { CommunityFeedList } from "@/components/feeds/CommunityFeedList";
import { CommunityPreviewModal } from "@/components/communities/CommunityPreviewModal";
import { FEED_PAGE_SIZE, feedItemKind, type FeedItem } from "@/components/feeds/types";
import { Spinner } from "@/components/ui/Spinner";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import { applyContentChanges } from "@/lib/communities/content-sync";
import { useContentChanges } from "@/lib/communities/use-content-changes";
import { DEFAULT_HOME_FEED_SCOPE, type HomeFeedScope } from "@/lib/feeds/home-feed-options";

interface HomeFeedProps {
  currentUserId: string;
  refreshToken?: number;
  /** Feed source — `public` (public, unjoined communities) or `communities` (joined only). */
  scope: HomeFeedScope;
}

/** Empty-state copy per feed source — the two tabs show disjoint posts. */
const EMPTY_STATE_DESCRIPTION: Record<HomeFeedScope, string> = {
  public: "Posts that members share publicly — from communities you haven't joined — will appear here.",
  communities:
    "Everything posted in the communities you've joined will appear here, whether or not it was shared publicly.",
  // Not reachable from the switcher; `all` is the server-side legacy default.
  all: "Posts that members share publicly will appear here.",
};

/**
 * The homepage feed: fetches and paginates the cross-community card page, then
 * hands it to the shared CommunityFeedList, which renders the same cards (and
 * the same mutations) as the profile activity tabs.
 */
export function HomeFeed({ currentUserId, refreshToken = 0, scope }: HomeFeedProps) {
  initRequestCache(currentUserId);
  // Matches the fetch URL below for the default filter choice, so the first
  // render of a revisit can hydrate straight from the request cache.
  const cached = getCachedRequest<{ items?: FeedItem[] }>(
    `/api/home/feed?scope=${DEFAULT_HOME_FEED_SCOPE}`,
    currentUserId,
  );
  const [items, setItems] = useState<FeedItem[]>(() => cached?.items ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(() => (cached?.items?.length ?? 0) >= FEED_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Non-member community preview popup, opened from a card's "posted in …" label. */
  const [previewCommunityId, setPreviewCommunityId] = useState<string | null>(null);

  const feedUrl = `/api/home/feed?scope=${encodeURIComponent(scope)}`;

  const fetchFeed = useCallback(async (background = false, force = false) => {
    if (!background) setLoading(true);
    try {
      const data = await fetchJsonCached<{ items?: FeedItem[] }>(
        feedUrl,
        { staleMs: 30_000, force },
        currentUserId,
      );
      setItems(data.items ?? []);
      setHasMore((data.items?.length ?? 0) >= FEED_PAGE_SIZE);
      setError(null);
    } catch (fetchError: unknown) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load the feed.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, feedUrl]);

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void fetchFeed(true, refreshToken > 0), 0);
    return () => {
      window.clearTimeout(initialFetch);
    };
  }, [fetchFeed, refreshToken]);

  // Refetch when returning after a real absence (no realtime subscription keeps
  // the feed current); brief alt-tabs no longer fire a request each.
  useHiddenCatchUp(() => void fetchFeed(true));

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
      const incoming = data.items ?? [];
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
        emptyState={(
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="font-body text-sm font-medium text-foreground-muted">No posts yet</p>
            <p className="mt-1 max-w-xs font-body text-xs text-foreground-subtle">
              {EMPTY_STATE_DESCRIPTION[scope]}
            </p>
          </div>
        )}
      />

      {items.length > 0 && hasMore && (
        <div className="flex justify-center border-t border-border py-6">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="rounded-lg border border-border px-4 py-2 font-body text-sm text-foreground hover:bg-surface-raised disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load older posts"}
          </button>
        </div>
      )}
    </>
  );
}
