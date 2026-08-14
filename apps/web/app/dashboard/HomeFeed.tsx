"use client";

import { useEffect, useState, useCallback } from "react";
import { Globe } from "lucide-react";

import { ThreadCard } from "@/components/communities/threads/ThreadCard";
import { EventCard } from "@/components/communities/events/EventCard";
import { ResourceCard } from "@/components/communities/resources/ResourceCard";
import type { CommunityThread } from "@/components/communities/threads/types";
import type { CommunityEvent } from "@/components/communities/events/types";
import type { CommunityResource } from "@/components/communities/resources/types";
import { PUBLIC_CONTENT_SCOPE } from "@/lib/content-scope";
import { communityFeedLayout } from "@/components/communities/feed-layout";
import { PostAuthorMeta } from "@/components/communities/PostAuthorMeta";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";

// Feed item as returned by /api/home/feed — typed union
type FeedThread   = Omit<CommunityThread, "community_id"> & { _type: "thread";   community_id: string | null; community_name: string | null; community_image: string | null };
type FeedEvent    = Omit<CommunityEvent, "community_id"> & { _type: "event";    community_id: string | null; community_name: string | null; community_image: string | null };
type FeedResource = Omit<CommunityResource, "community_id"> & { _type: "resource"; community_id: string | null; community_name: string | null; community_image: string | null };
type FeedItem = FeedThread | FeedEvent | FeedResource;

/** Must match PAGE_SIZE in /api/home/feed. */
const HOME_FEED_PAGE_SIZE = 30;

interface HomeFeedProps {
  currentUserId: string;
  refreshToken?: number;
}

export function HomeFeed({ currentUserId, refreshToken = 0 }: HomeFeedProps) {
  initRequestCache(currentUserId);
  const cached = getCachedRequest<{ items?: FeedItem[] }>("/api/home/feed", currentUserId);
  const [items, setItems] = useState<FeedItem[]>(() => cached?.items ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(() => (cached?.items?.length ?? 0) >= HOME_FEED_PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchFeed = useCallback(async (background = false, force = false) => {
    if (!background) setLoading(true);
    try {
      const data = await fetchJsonCached<{ items?: FeedItem[] }>(
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
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") void fetchFeed(true);
    };
    document.addEventListener("visibilitychange", refreshOnFocus);
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      window.clearTimeout(initialFetch);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [fetchFeed, refreshToken]);

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const updateItems = useCallback((update: (current: FeedItem[]) => FeedItem[]) => {
    setItems((current) => {
      const next = update(current);
      patchCachedRequest<{ items?: FeedItem[] }>(
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

  const handleThreadVoteChanged = useCallback((id: string, voted: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "thread" && it.id === id
        ? { ...it, user_voted: voted, vote_count: count }
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

  const handleEventUpdated = useCallback((updated: CommunityEvent) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "event" && it.id === updated.id ? { ...it, ...updated } : it
    ));
  }, [updateItems]);

  const handleEventDeleted = useCallback((id: string) => {
    updateItems((prev) => prev.filter((it) => !(it._type === "event" && it.id === id)));
  }, [updateItems]);

  const handleEventRsvpChanged = useCallback((id: string, rsvped: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "event" && it.id === id
        ? { ...it, user_rsvped: rsvped, rsvp_count: count }
        : it
    ));
  }, [updateItems]);

  const handleEventLikeChanged = useCallback((id: string, liked: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "event" && it.id === id
        ? { ...it, user_liked: liked, like_count: count }
        : it
    ));
  }, [updateItems]);

  const handleEventSaveChanged = useCallback((id: string, saved: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "event" && it.id === id
        ? { ...it, user_saved: saved, save_count: count }
        : it
    ));
  }, [updateItems]);

  const handleResourceUpdated = useCallback((updated: CommunityResource) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "resource" && it.id === updated.id ? { ...it, ...updated } : it
    ));
  }, [updateItems]);

  const handleResourceSaveChanged = useCallback((id: string, saved: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "resource" && it.id === id
        ? { ...it, user_saved: saved, save_count: count }
        : it
    ));
  }, [updateItems]);

  const handleResourceBookmarkChanged = useCallback((id: string, bookmarked: boolean, count: number) => {
    updateItems((prev) => prev.map((it) =>
      it._type === "resource" && it.id === id
        ? { ...it, user_bookmarked: bookmarked, bookmark_count: count }
        : it
    ));
  }, [updateItems]);

  const handleResourceDeleted = useCallback((id: string) => {
    updateItems((prev) => prev.filter((it) => !(it._type === "resource" && it.id === id)));
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
      const data = await response.json() as { items?: FeedItem[] };
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
      <ul className="border-t border-border animate-pulse">
        {[1, 2, 3].map((item) => (
          <li key={item} className={`border-b border-border ${communityFeedLayout.row}`}>
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-surface-raised" />
              <div className="flex items-center gap-2">
                <div className="h-3 w-20 rounded bg-surface-raised" />
                <div className="h-3 w-12 rounded bg-surface-raised" />
                <div className="h-5 w-16 rounded-full bg-surface-raised" />
              </div>
            </div>
            <div className="mt-4 h-4 w-3/4 rounded bg-surface-raised" />
            <div className="mt-2.5 space-y-2">
              <div className="h-3 w-full rounded bg-surface-raised" />
              <div className="h-3 w-5/6 rounded bg-surface-raised" />
              <div className="h-3 w-2/3 rounded bg-surface-raised" />
            </div>
            <div className="mt-4 flex items-center gap-4">
              <div className="h-8 w-8 rounded-full bg-surface-raised" />
              <div className="h-3 w-6 rounded bg-surface-raised" />
              <div className="h-3 w-20 rounded bg-surface-raised" />
            </div>
          </li>
        ))}
        {/* Resource skeleton row */}
        <li className={`border-b border-border ${communityFeedLayout.row}`}>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 shrink-0 rounded-full bg-surface-raised" />
            <div className="h-3 w-28 rounded bg-surface-raised" />
          </div>
          <div className="mt-4 h-4 w-3/4 rounded bg-surface-raised" />
          <div className="mt-2 h-3 w-1/2 rounded bg-surface-raised" />
          <div className="mt-4 h-52 w-full rounded-xl bg-surface-raised" />
          <div className="mt-4 flex items-center gap-4">
            <div className="h-5 w-12 rounded bg-surface-raised" />
            <div className="h-5 w-12 rounded bg-surface-raised" />
          </div>
        </li>
      </ul>
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
          When community members share threads, events, or resources publicly, they&apos;ll appear here.
        </p>
      </div>
    );
  }

  // Group items so consecutive resources are batched together into a
  // 2-column grid, while threads and events stay full-width.
  type Group =
    | { kind: "thread"; item: FeedThread }
    | { kind: "event";  item: FeedEvent }
    | { kind: "resources"; items: FeedResource[] };

  const groups: Group[] = [];
  for (const item of items) {
    if (item._type === "resource") {
      const last = groups[groups.length - 1];
      if (last?.kind === "resources") {
        last.items.push(item);
      } else {
        groups.push({ kind: "resources", items: [item] });
      }
    } else if (item._type === "thread") {
      groups.push({ kind: "thread", item });
    } else {
      groups.push({ kind: "event", item });
    }
  }

  return (
    <>
    <ul className="border-t border-border">
      {groups.map((group, gi) => {
        const isLastGroup = gi === groups.length - 1;

        if (group.kind === "thread") {
          return (
            <li key={`thread-${group.item.id}`}>
              <ThreadCard
                thread={{ ...group.item, community_id: group.item.community_id ?? "" }}
                currentUserId={currentUserId}
                communityId={group.item.community_id ?? PUBLIC_CONTENT_SCOPE}
                communityName={group.item.community_name ?? undefined}
                communityImage={group.item.community_image}
                communityNamePlacement="below"
                detailHref={`/dashboard/threads/${group.item.id}`}
                onUpdated={handleThreadUpdated}
                onVoteChanged={handleThreadVoteChanged}
                onSaveChanged={handleThreadSaveChanged}
                onDeleted={handleThreadDeleted}
                isLast={isLastGroup}
              />
            </li>
          );
        }

        if (group.kind === "event") {
          return (
            <li key={`event-${group.item.id}`} className={isLastGroup ? "" : "border-b border-border"}>
              <div className={`${communityFeedLayout.row} relative`}>
                <PostAuthorMeta
                  name={group.item.users?.name}
                  avatarUrl={group.item.users?.avatar_url}
                  createdAt={group.item.created_at}
                  dateInline
                  secondaryLabel={`Event · ${group.item.is_online ? "Online" : group.item.location ?? "Offline"}`}
                  className="mb-3"
                />
                <EventCard
                  event={{ ...group.item, community_id: group.item.community_id ?? "" }}
                  currentUserId={currentUserId}
                  communityId={group.item.community_id ?? PUBLIC_CONTENT_SCOPE}
                  detailHref={`/dashboard/events/${group.item.id}`}
                  menuInPostHeader
                  communityName={group.item.community_name ?? undefined}
                  communityImage={group.item.community_image}
                  onUpdated={handleEventUpdated}
                  onDeleted={handleEventDeleted}
                onRsvpChanged={handleEventRsvpChanged}
                onLikeChanged={handleEventLikeChanged}
                onSaveChanged={handleEventSaveChanged}
                />
              </div>
            </li>
          );
        }

        // ── Resource group — same full-width layout as community resources ──
        return group.items.map((res, resourceIndex) => {
          const isLastResource = resourceIndex === group.items.length - 1;
          const showDivider = !isLastGroup || !isLastResource;

          return (
            <li
              key={`resource-${res.id}`}
              className={`${communityFeedLayout.gutters} ${showDivider ? communityFeedLayout.dividerBottom : ""}`}
            >
              <ResourceCard
                resource={{ ...res, community_id: res.community_id ?? "" }}
                currentUserId={currentUserId}
                communityId={res.community_id ?? PUBLIC_CONTENT_SCOPE}
                communityName={res.community_name ?? undefined}
                communityImage={res.community_image}
                onUpdated={handleResourceUpdated}
                onSaveChanged={handleResourceSaveChanged}
                onBookmarkChanged={handleResourceBookmarkChanged}
                onDeleted={handleResourceDeleted}
                hideDivider
              />
            </li>
          );
        });
      })}
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
