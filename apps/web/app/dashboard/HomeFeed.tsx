"use client";

import { useEffect, useState, useCallback } from "react";
import { Globe } from "lucide-react";

import { ThreadCard } from "@/components/communities/threads/ThreadCard";
import { EventCard } from "@/components/communities/events/EventCard";
import { ResourceCard } from "@/components/communities/resources/ResourceCard";
import { ShowcaseCard } from "@/components/communities/showcase/ShowcaseCard";
import { CreateShowcaseModal } from "@/components/communities/showcase/CreateShowcaseModal";
import type { CommunityThread } from "@/components/communities/threads/types";
import type { CommunityEvent, EventRsvp } from "@/components/communities/events/types";
import type { CommunityResource } from "@/components/communities/resources/types";
import type { ShowcasePost } from "@/components/communities/showcase/types";
import { PUBLIC_CONTENT_SCOPE } from "@/lib/content-scope";
import { communityFeedLayout } from "@/components/communities/feed-layout";
import { PostAuthorMeta } from "@/components/communities/PostAuthorMeta";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import { useGuardedRouter } from "@/lib/navigation-guard";

// Feed item as returned by /api/home/feed — typed union
type FeedThread = Omit<CommunityThread, "community_id"> & { _type: "thread"; community_id: string | null; community_name: string | null; community_image: string | null };
type FeedEvent = Omit<CommunityEvent, "community_id"> & { _type: "event"; community_id: string | null; community_name: string | null; community_image: string | null; rsvps?: EventRsvp[] };
type FeedResource = Omit<CommunityResource, "community_id"> & { _type: "resource"; community_id: string | null; community_name: string | null; community_image: string | null };
type FeedShowcase = Omit<ShowcasePost, "community_id"> & { _type: "showcase"; community_id: string | null; community_name: string | null; community_image: string | null };
type FeedItem = FeedThread | FeedEvent | FeedResource | FeedShowcase;

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
  const [editingShowcase, setEditingShowcase] = useState<FeedShowcase | null>(null);
  const [deletingShowcase, setDeletingShowcase] = useState<FeedShowcase | null>(null);
  const router = useGuardedRouter();

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
    return () => {
      window.clearTimeout(initialFetch);
    };
  }, [fetchFeed, refreshToken]);

  // Refetch when returning after a real absence (no realtime channel keeps the
  // feed current); brief alt-tabs no longer fire a request each.
  useHiddenCatchUp(() => void fetchFeed(true));

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

  const openShowcase = useCallback((post: FeedShowcase) => {
    if (post.community_id) router.push(`/dashboard/communities/${post.community_id}/showcase/${post.id}`);
  }, [router]);

  const handleShowcaseUpdated = useCallback((updated: ShowcasePost) => {
    setEditingShowcase(null);
    updateItems((prev) => prev.map((it) =>
      it._type === "showcase" && it.id === updated.id
        ? { ...it, ...updated, community_id: it.community_id, community_name: it.community_name, community_image: it.community_image }
        : it
    ));
  }, [updateItems]);

  const handleShowcaseDeleted = useCallback(async (post: FeedShowcase) => {
    if (!post.community_id) return;
    const response = await fetch(`/api/communities/${post.community_id}/showcase/${post.id}`, { method: "DELETE" });
    if (response.ok) updateItems((prev) => prev.filter((it) => !(it._type === "showcase" && it.id === post.id)));
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
          When community members share threads, events, resources, or showcase
          work publicly, they&apos;ll appear here.
        </p>
      </div>
    );
  }

  // Group consecutive resources together while keeping threads, events, and
  // showcase posts full-width in the feed.
  type Group =
    | { kind: "thread"; item: FeedThread }
    | { kind: "event"; item: FeedEvent }
    | { kind: "showcase"; item: FeedShowcase }
    | { kind: "resources"; items: FeedResource[] };

  const groups: Group[] = [];
  for (const item of items) {
    if (item._type === "resource") {
      const last = groups[groups.length - 1];
      if (last?.kind === "resources") last.items.push(item);
      else groups.push({ kind: "resources", items: [item] });
    } else if (item._type === "thread") {
      groups.push({ kind: "thread", item });
    } else if (item._type === "event") {
      groups.push({ kind: "event", item });
    } else {
      groups.push({ kind: "showcase", item });
    }
  }

  const cardClassName =
    "overflow-hidden rounded-xl border border-border [&>article]:border-0 [&>article]:rounded-none [&>div>article]:border-0 [&>div>article]:rounded-none";

  return (
    <>
    <ul className="flex flex-col gap-4">
      {groups.map((group) => {
        if (group.kind === "thread") {
          return (
            <li key={`thread-${group.item.id}`} className={cardClassName}>
              <ThreadCard
                thread={{ ...group.item, community_id: group.item.community_id ?? "" }}
                currentUserId={currentUserId}
                communityId={group.item.community_id ?? PUBLIC_CONTENT_SCOPE}
                communityName={group.item.community_name ?? undefined}
                communityImage={group.item.community_image}
                communityNamePlacement="below"
                detailHref={`/dashboard/threads/${group.item.id}`}
                onUpdated={handleThreadUpdated}
                onLikeChanged={handleThreadLikeChanged}
                onSaveChanged={handleThreadSaveChanged}
                onDeleted={handleThreadDeleted}
                isLast
              />
            </li>
          );
        }

        if (group.kind === "event") {
          return (
            <li key={`event-${group.item.id}`} className={cardClassName}>
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
                  rsvps={group.item.rsvps}
                  currentUserId={currentUserId}
                  communityId={group.item.community_id ?? PUBLIC_CONTENT_SCOPE}
                  detailHref={group.item.community_id ? `/dashboard/communities/${group.item.community_id}/events/${group.item.id}` : undefined}
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

        if (group.kind === "showcase") {
          return (
            <li key={`showcase-${group.item.id}`} className={cardClassName}>
              <ShowcaseCard
                post={{ ...group.item, community_id: group.item.community_id ?? "" }}
                currentUserId={currentUserId}
                isLast
                communityId={group.item.community_id ?? PUBLIC_CONTENT_SCOPE}
                onOpen={() => openShowcase(group.item)}
                onLikeChanged={(liked, count) => updateItems((prev) => prev.map((item) =>
                  item._type === "showcase" && item.id === group.item.id
                    ? { ...item, user_liked: liked, like_count: count }
                    : item
                ))}
                onSaveChanged={(saved) => updateItems((prev) => prev.map((item) =>
                  item._type === "showcase" && item.id === group.item.id
                    ? { ...item, user_saved: saved }
                    : item
                ))}
                onEdit={() => setEditingShowcase(group.item)}
                onDelete={() => setDeletingShowcase(group.item)}
              />
            </li>
          );
        }

        return group.items.map((resource) => (
          <li
            key={`resource-${resource.id}`}
            className={`${cardClassName} ${communityFeedLayout.gutters} py-6`}
          >
            <ResourceCard
              resource={{ ...resource, community_id: resource.community_id ?? "" }}
              currentUserId={currentUserId}
              communityId={resource.community_id ?? PUBLIC_CONTENT_SCOPE}
              communityName={resource.community_name ?? undefined}
              communityImage={resource.community_image}
              onUpdated={handleResourceUpdated}
              onSaveChanged={handleResourceSaveChanged}
              onBookmarkChanged={handleResourceBookmarkChanged}
              onDeleted={handleResourceDeleted}
              hideDivider
            />
          </li>
        ));
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

    {editingShowcase && editingShowcase.community_id && (
      <CreateShowcaseModal
        communityId={editingShowcase.community_id}
        initialIsPublic={editingShowcase.is_public}
        post={editingShowcase as ShowcasePost}
        onClose={() => setEditingShowcase(null)}
        onUpdated={handleShowcaseUpdated}
      />
    )}

    <ConfirmDialog
      open={!!deletingShowcase}
      title="Delete showcase post?"
      message="This will permanently remove this showcase post. This cannot be undone."
      onClose={() => setDeletingShowcase(null)}
      onConfirm={() => {
        if (deletingShowcase) return handleShowcaseDeleted(deletingShowcase);
      }}
    />

    </>
  );
}
