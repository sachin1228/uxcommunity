"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BookMarked,
  BookOpen,
  Box,
  CircleEllipsis,
  FileText,
  Grid2X2,
  Image,
  LayoutGrid,
  Palette,
  Play,
  Plus,
  Shapes,
  Type,
  Wrench,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { CommunityResource } from "./types";
import { RESOURCE_TYPES } from "./types";
import { CreateResourceModal } from "./CreateResourceModal";
import { ResourceCard } from "./ResourceCard";
import { communityFeedLayout } from "../feed-layout";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";

const RESOURCES_STALE_MS = 60_000;
/** Must match PAGE_SIZE in the resources list read model. */
const RESOURCE_PAGE_SIZE = 100;

type FilterType = "all" | CommunityResource["resource_type"];

export function ResourcesView({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  initRequestCache(currentUserId);
  const requestUrl = `/api/communities/${communityId}/resources`;
  const cached = getCachedRequest<{ resources?: CommunityResource[]; nextCursor?: string | null }>(requestUrl, currentUserId);
  const [resources, setResources] = useState<CommunityResource[]>(() => cached?.resources ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [hasMore, setHasMore] = useState(() => {
    const nextCursor = cached?.nextCursor;
    return nextCursor !== undefined ? nextCursor !== null : (cached?.resources?.length ?? 0) >= RESOURCE_PAGE_SIZE;
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");

  const fetchResources = useCallback(async (background = false, force = false) => {
    if (!background) setLoading(true);
    try {
      const data = await fetchJsonCached<{ resources?: CommunityResource[]; nextCursor?: string | null }>(
        requestUrl,
        { staleMs: RESOURCES_STALE_MS, force },
        currentUserId,
      );
      setResources(data.resources ?? []);
      setHasMore(
        data.nextCursor !== undefined
          ? data.nextCursor !== null
          : (data.resources?.length ?? 0) >= RESOURCE_PAGE_SIZE,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resources.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, requestUrl]);

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void fetchResources(true), 0);
    let supabase: ReturnType<typeof createBrowserClient>;
    try { supabase = createBrowserClient(); } catch { return; }

    const channel = supabase
      .channel(`community-resources:${communityId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "community_resources",
        filter: `community_id=eq.${communityId}`,
      }, () => void fetchResources(true, true))
      .subscribe();

    const saveChannel = supabase
      .channel(`resource-saves:${communityId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "resource_saves",
      }, (payload) => {
        const record = (payload.new ?? payload.old) as { resource_id?: string; user_id?: string } | null;
        if (!record?.resource_id) return;
        if (record.user_id === currentUserId) return;
        const resourceId = record.resource_id;
        setResources((prev) =>
          prev.map((r) => {
            if (r.id !== resourceId) return r;
            if (payload.eventType === "INSERT") return { ...r, save_count: r.save_count + 1 };
            if (payload.eventType === "DELETE") return { ...r, save_count: Math.max(0, r.save_count - 1) };
            return r;
          }),
        );
      })
      .subscribe();

    const handleFocus = () => { if (document.visibilityState === "visible") void fetchResources(true); };
    document.addEventListener("visibilitychange", handleFocus);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearTimeout(initialFetch);
      supabase.removeChannel(channel);
      supabase.removeChannel(saveChannel);
      document.removeEventListener("visibilitychange", handleFocus);
      window.removeEventListener("focus", handleFocus);
    };
  }, [communityId, currentUserId, fetchResources]);

  function writeCache(updater: (prev: CommunityResource[]) => CommunityResource[]) {
    setResources((prev) => {
      const next = updater(prev);
      patchCachedRequest<{ resources?: CommunityResource[] }>(
        requestUrl,
        (current) => ({ ...current, resources: next }),
        currentUserId,
      );
      return next;
    });
  }

  function handleCreated(resource: CommunityResource) {
    writeCache((prev) => [resource, ...prev.filter((r) => r.id !== resource.id)]);
  }

  function handleUpdated(updated: CommunityResource) {
    writeCache((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
  }

  function handleSaveChanged(resourceId: string, saved: boolean, newCount: number) {
    writeCache((prev) => prev.map((r) => r.id === resourceId ? { ...r, user_saved: saved, save_count: newCount } : r));
  }

  function handleBookmarkChanged(resourceId: string, bookmarked: boolean, newCount: number) {
    writeCache((prev) => prev.map((r) => r.id === resourceId ? { ...r, user_bookmarked: bookmarked, bookmark_count: newCount } : r));
  }

  function handleDeleted(resourceId: string) {
    writeCache((prev) => prev.filter((r) => r.id !== resourceId));
  }

  // ── Load older resources (keyset pagination via ?cursor=createdAt|id) ────
  async function loadMore() {
    if (loadingMore || !resources.length) return;
    const last = resources[resources.length - 1];
    setLoadingMore(true);
    try {
      const response = await fetch(
        `${requestUrl}?cursor=${encodeURIComponent(`${last.created_at}|${last.id}`)}`,
      );
      if (!response.ok) return;
      const data = await response.json() as { resources?: CommunityResource[]; nextCursor?: string | null };
      writeCache((current) => {
        const byId = new Map(current.map((r) => [r.id, r]));
        for (const resource of data.resources ?? []) byId.set(resource.id, resource);
        return [...byId.values()];
      });
      setHasMore(data.nextCursor !== null && data.nextCursor !== undefined);
    } finally {
      setLoadingMore(false);
    }
  }

  // Derive which type filters have results
  const typesWithData = new Set(resources.map((r) => r.resource_type));
  const filtered = filter === "all" ? resources : resources.filter((r) => r.resource_type === filter);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={`${communityFeedLayout.content} ${!loading && resources.length > 0 ? communityFeedLayout.pageHeaderWithFilters : communityFeedLayout.pageHeader}`}>
        <div className={communityFeedLayout.pageHeaderMain}>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-foreground">Resources</h2>
            <p className="mt-1 max-w-sm text-pretty font-body text-sm leading-5 text-foreground-muted">
              <span className="block">Figma files, articles, tools, and more — shared by your</span>
              <span className="block">community.</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover"
          >
            <Plus size={14} /> Share Resource
          </button>
        </div>

        {!loading && resources.length > 0 && (
          <div className={`${communityFeedLayout.pageHeaderFilters} flex items-center gap-2 overflow-x-auto pb-1`}>
            {[{ value: "all" as const, label: "All", icon: LayoutGrid }, ...RESOURCE_TYPES.filter((item) => typesWithData.has(item.value)).map((item) => ({
              ...item,
              icon: {
                figma: Shapes,
                article: FileText,
                tool: Wrench,
                video: Play,
                book: BookOpen,
                font: Type,
                icon_pack: Grid2X2,
                color: Palette,
                template: Box,
                inspiration: Image,
                other: CircleEllipsis,
              }[item.value],
            }))].map((item) => {
              const Icon = item.icon;
              const count = item.value === "all" ? resources.length : resources.filter((resource) => resource.resource_type === item.value).length;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  aria-pressed={filter === item.value}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 font-body text-xs transition-colors ${filter === item.value ? "border-accent bg-accent/5 text-accent" : "border-border text-foreground-muted hover:border-foreground-subtle hover:text-foreground"}`}
                >
                  <Icon size={14} aria-hidden="true" />
                  {item.label}
                  <span className="font-mono text-[10px]">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="font-body text-sm text-red-400">{error}</p>
            <button type="button" onClick={() => void fetchResources()} className="font-body text-xs text-red-300 underline">
              Try again
            </button>
          </div>
        )}

      </div>

      <div className={communityFeedLayout.content}>
        {loading ? (
          <div className={communityFeedLayout.skeletonList}>
            {[1, 2, 3].map((i) => (
              <div key={i} className={communityFeedLayout.skeletonRow}>
                <div className="flex items-center justify-between">
                  <div className="h-5 w-20 rounded-full bg-surface-raised" />
                  <div className="h-5 w-5 rounded bg-surface-raised" />
                </div>
                <div className="mt-3 h-4 w-2/3 rounded bg-surface-raised" />
                <div className="mt-2 space-y-1.5">
                  <div className="h-3 w-full rounded bg-surface-raised" />
                  <div className="h-3 w-4/5 rounded bg-surface-raised" />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-surface-raised" />
                  <div className="h-2.5 w-16 rounded bg-surface-raised" />
                  <div className="h-2.5 w-12 rounded bg-surface-raised" />
                </div>
              </div>
            ))}
          </div>
        ) : resources.length === 0 ? (
          <div className={communityFeedLayout.emptyState}>
            <BookMarked size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No resources yet</h3>
            <p className={communityFeedLayout.emptyDescription}>
              Be the first to share a Figma file, article, tool, or anything useful.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className={communityFeedLayout.emptyState}>
            <BookMarked size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No resources in this category</h3>
            <p className={communityFeedLayout.emptyDescription}>Try a different filter or share one yourself.</p>
          </div>
        ) : (
          <div>
            {filtered.map((resource) => (
              <div
                key={resource.id}
                className={`${communityFeedLayout.gutters} ${communityFeedLayout.dividerBottom}`}
              >
                <ResourceCard
                  resource={resource}
                  currentUserId={currentUserId}
                  communityId={communityId}
                  onUpdated={handleUpdated}
                  onSaveChanged={handleSaveChanged}
                  onBookmarkChanged={handleBookmarkChanged}
                  onDeleted={handleDeleted}
                  hideDivider
                />
              </div>
            ))}
            {hasMore && (
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

      {showCreateModal && (
        <CreateResourceModal
          communityId={communityId}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
