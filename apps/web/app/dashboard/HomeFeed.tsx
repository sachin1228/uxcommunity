"use client";

import { useEffect, useState, useCallback } from "react";
import { Globe } from "lucide-react";

import { ThreadCard } from "@/components/communities/threads/ThreadCard";
import type { CommunityThread } from "@/components/communities/threads/types";
import { PUBLIC_CONTENT_SCOPE } from "@/lib/content-scope";
import { Spinner } from "@/components/ui/Spinner";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";

// The home feed contains public posts created from the homepage composer.
type FeedThread = Omit<CommunityThread, "community_id"> & {
  _type: "thread";
  community_id: string | null;
  community_name: string | null;
  community_image: string | null;
};

/** Must match PAGE_SIZE in /api/home/feed. */
const HOME_FEED_PAGE_SIZE = 30;

interface HomeFeedProps {
  currentUserId: string;
  refreshToken?: number;
}

export function HomeFeed({ currentUserId, refreshToken = 0 }: HomeFeedProps) {
  initRequestCache(currentUserId);
  const cached = getCachedRequest<{ items?: FeedThread[] }>("/api/home/feed", currentUserId);
  const [items, setItems] = useState<FeedThread[]>(() => cached?.items ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(() => (cached?.items?.length ?? 0) >= HOME_FEED_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchFeed = useCallback(async (background = false, force = false) => {
    if (!background) setLoading(true);
    try {
      const data = await fetchJsonCached<{ items?: FeedThread[] }>(
        "/api/home/feed",
        { staleMs: 30_000, force },
        currentUserId,
      );
      setItems(data.items ?? []);
      setHasMore((data.items?.length ?? 0) >= HOME_FEED_PAGE_SIZE);
      setError(null);
    } catch (fetchError: unknown) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load the feed.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void fetchFeed(true, refreshToken > 0), 0);
    return () => {
      window.clearTimeout(initialFetch);
    };
  }, [fetchFeed, refreshToken]);

  // Refetch when returning after a real absence (no realtime channel keeps the
  // feed current); brief alt-tabs no longer fire a request each.
  useHiddenCatchUp(() => void fetchFeed(true));

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const updateItems = useCallback((update: (current: FeedThread[]) => FeedThread[]) => {
    setItems((current) => {
      const next = update(current);
      patchCachedRequest<{ items?: FeedThread[] }>(
        "/api/home/feed",
        (cachedFeed) => ({ ...cachedFeed, items: next }),
        currentUserId,
      );
      return next;
    });
  }, [currentUserId]);

  const handleThreadUpdated = useCallback((updated: CommunityThread) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "thread" && it.id === updated.id ? { ...it, ...updated } : it
    ));
  }, [updateItems]);

  const handleThreadLikeChanged = useCallback((id: string, liked: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "thread" && it.id === id
        ? { ...it, user_liked: liked, like_count: count }
        : it
    ));
  }, [updateItems]);

  const handleThreadSaveChanged = useCallback((id: string, saved: boolean) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "thread" && it.id === id ? { ...it, user_saved: saved } : it
    ));
  }, [updateItems]);

  const handleThreadDeleted = useCallback((id: string) => {
    updateItems((prev) => prev.filter((it) => !(it._type === "thread" && it.id === id)));
  }, [updateItems]);

  // ── Load older posts (keyset pagination via ?before=created_at) ──────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !items.length) return;
    const last = items[items.length - 1];
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/home/feed?before=${encodeURIComponent(last.created_at)}`,
      );
      if (!response.ok) return;
      const data = await response.json() as { items?: FeedThread[] };
      const incoming = data.items ?? [];
      updateItems((prev) => {
        const ids = new Set(prev.map((item) => item.id));
        return [...prev, ...incoming.filter((item) => !ids.has(item.id))];
      });
      setHasMore(incoming.length >= HOME_FEED_PAGE_SIZE);
    } catch {
      // Network error — leave the feed as-is.
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore, updateItems]);

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

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Globe size={32} className="mb-3 text-foreground-subtle" />
        <p className="font-body text-sm font-medium text-foreground-muted">Nothing public yet</p>
        <p className="mt-1 max-w-xs font-body text-xs text-foreground-subtle">
          When community members share a public post, it&apos;ll appear here.
        </p>
      </div>
    );
  }

  const cardClassName =
    "overflow-hidden rounded-xl border border-border [&>article]:border-0 [&>article]:rounded-none [&>div>article]:border-0 [&>div>article]:rounded-none";

  return (
    <>
    <ul className="flex flex-col gap-4">
      {items.map((item) => (
        <li key={`thread-${item.id}`} className={cardClassName}>
          <ThreadCard
            thread={{ ...item, community_id: item.community_id ?? "" }}
            currentUserId={currentUserId}
            communityId={item.community_id ?? PUBLIC_CONTENT_SCOPE}
            communityName={item.community_name ?? undefined}
            communityImage={item.community_image}
            communityNamePlacement="below"
            detailHref={`/dashboard/threads/${item.id}`}
            onUpdated={handleThreadUpdated}
            onLikeChanged={handleThreadLikeChanged}
            onSaveChanged={handleThreadSaveChanged}
            onDeleted={handleThreadDeleted}
            isLast
          />
        </li>
      ))}
    </ul>

    {hasMore && (
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
