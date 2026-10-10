"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Images, Play } from "lucide-react";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { Spinner } from "@/components/ui/Spinner";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";
import { communityFeedLayout } from "../feed-layout";
import { fmtDate } from "../chat/chatUtils";
import { MediaLightbox } from "./MediaLightbox";
import {
  isVideoItem,
  mediaItemKey,
  mediaSourceHref,
  mediaThumbUrl,
  MEDIA_SOURCE_ICONS,
  MEDIA_SOURCE_LABELS,
  type CommunityMediaItem,
} from "./types";

const STALE = 30_000;

interface MediaPage {
  media?: CommunityMediaItem[];
  nextCursor?: string | null;
}

/**
 * The community Media tab: a date-grouped grid of every picture and video the
 * community posted outside chat — thread images, showcase images/videos and
 * event covers.
 */
export function MediaView({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const router = useGuardedRouter();
  initRequestCache(currentUserId);
  const requestUrl = `/api/communities/${communityId}/media`;
  const cached = getCachedRequest<MediaPage>(requestUrl, currentUserId);
  const [media, setMedia] = useState<CommunityMediaItem[]>(cached?.media ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(cached?.nextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const fetchMedia = useCallback(
    async (force = false) => {
      setLoading(true);
      try {
        const data = await fetchJsonCached<MediaPage>(requestUrl, { staleMs: STALE, force }, currentUserId);
        setMedia(data.media ?? []);
        setNextCursor(data.nextCursor ?? null);
        setError(null);
      } catch (fetchError) {
        setError(
          fetchError instanceof Error ? fetchError.message : "We couldn't load the community media.",
        );
      } finally {
        setLoading(false);
      }
    },
    [currentUserId, requestUrl],
  );

  useEffect(() => {
    // Deferred a tick (as ThreadsView does): the fetch sets loading
    // synchronously, and setState directly in an effect cascades renders.
    const initialFetch = window.setTimeout(() => void fetchMedia(), 0);
    return () => window.clearTimeout(initialFetch);
  }, [fetchMedia]);

  // The feed is newest-first, so items sharing a day are always adjacent.
  const dayGroups = useMemo(() => {
    const groups: Array<{ label: string; items: CommunityMediaItem[] }> = [];
    for (const item of media) {
      const label = fmtDate(item.created_at);
      const last = groups.at(-1);
      if (last && last.label === label) last.items.push(item);
      else groups.push({ label, items: [item] });
    }
    return groups;
  }, [media]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`${requestUrl}?cursor=${encodeURIComponent(nextCursor)}`);
      if (!response.ok) throw new Error("We couldn't load more media.");
      const data = (await response.json()) as MediaPage;
      const seen = new Set(media.map(mediaItemKey));
      const next = [...media, ...(data.media ?? []).filter((item) => !seen.has(mediaItemKey(item)))];
      setMedia(next);
      setNextCursor(data.nextCursor ?? null);
      patchCachedRequest<MediaPage>(
        requestUrl,
        (current) => ({ ...current, media: next, nextCursor: data.nextCursor ?? null }),
        currentUserId,
      );
      setError(null);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : "We couldn't load more media.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  function openSource(item: CommunityMediaItem) {
    setViewerIndex(null);
    router.push(mediaSourceHref(communityId, item));
  }

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className={`${communityFeedLayout.content} ${communityFeedLayout.pageHeader}`}>
        <div className={communityFeedLayout.pageHeaderMain}>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-foreground">Media</h2>
            <p className="mt-1 max-w-sm text-pretty font-body text-sm leading-5 text-foreground-muted">
              Photos and videos shared in this community&apos;s threads, showcase, and events.
            </p>
          </div>
        </div>
      </div>

      <div className={communityFeedLayout.content}>
        {error && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="font-body text-sm text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => void fetchMedia(true)}
              className="font-body text-xs text-red-300 underline"
            >
              Try again
            </button>
          </div>
        )}

        {loading && !media.length && (
          <div className="flex items-center justify-center py-24" role="status" aria-label="Loading media">
            <Spinner size={28} />
          </div>
        )}

        {!loading && !media.length && !error && (
          <div className={communityFeedLayout.emptyState}>
            <Images strokeWidth={2.5} size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No media yet</h3>
            <p className={communityFeedLayout.emptyDescription}>
              Photos and videos shared in threads, showcase posts, and events will show up here.
            </p>
          </div>
        )}

        {!!media.length && (
          <div className="pb-6">
            {dayGroups.map((group) => (
              <section key={group.label} className="mb-6 last:mb-0">
                <h3 className="mb-2 font-body text-xs font-medium text-foreground-muted">
                  {group.label}
                </h3>
                <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
                  {group.items.map((item) => {
                    const thumb = mediaThumbUrl(item);
                    const video = isVideoItem(item);
                    const SourceIcon = MEDIA_SOURCE_ICONS[item.source];
                    return (
                      <button
                        type="button"
                        key={mediaItemKey(item)}
                        onClick={() => setViewerIndex(media.indexOf(item))}
                        aria-label={`${video ? "Video" : "Photo"} from ${MEDIA_SOURCE_LABELS[item.source]} — ${item.source_title}`}
                        className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        {thumb ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={thumb}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center bg-neutral-900 text-white/70">
                            <Play strokeWidth={2.5} size={20} fill="currentColor" />
                          </span>
                        )}
                        {video && thumb && (
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white">
                              <Play strokeWidth={2.5} size={14} fill="currentColor" />
                            </span>
                          </span>
                        )}
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/75 via-black/35 to-transparent p-2 pt-7 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                          <SourceIcon strokeWidth={2.5} size={11} className="shrink-0 text-white/80" aria-hidden="true" />
                          <span className="truncate font-body text-[11px] text-white/90">
                            {MEDIA_SOURCE_LABELS[item.source]} · {item.source_title}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {nextCursor && (
              <div className="flex justify-center py-6">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="rounded-lg border border-border px-4 py-2 font-body text-sm text-foreground hover:bg-surface-raised disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {viewerIndex !== null && media[viewerIndex] && (
        <MediaLightbox
          items={media}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onNavigate={setViewerIndex}
          onOpenSource={openSource}
        />
      )}
    </div>
  );
}
