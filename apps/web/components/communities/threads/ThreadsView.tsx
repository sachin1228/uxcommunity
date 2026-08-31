"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CircleHelp,
  LayoutGrid,
  Lightbulb,
  MessageSquarePlus,
  MessageSquareText,
  MessagesSquare,
  Plus,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { THREAD_CATEGORIES, type CommunityThread, type ThreadCategory } from "./types";
import { CreateThreadModal } from "./CreateThreadModal";
import { ThreadCard } from "./ThreadCard";
import { communityFeedLayout } from "../feed-layout";
import { Spinner } from "@/components/ui/Spinner";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";

const THREADS_STALE_MS = 60_000;
/** Must match PAGE_SIZE in the threads list read model. */
const THREAD_PAGE_SIZE = 50;

export function ThreadsView({
  communityId,
  currentUserId,
  onThreadCreated,
}: {
  communityId: string;
  currentUserId: string;
  onThreadCreated?: (thread: CommunityThread) => void;
}) {
  initRequestCache(currentUserId);
  const router = useGuardedRouter();
  const requestUrl = `/api/communities/${communityId}/threads`;
  const cached = getCachedRequest<{ threads?: CommunityThread[]; nextCursor?: string | null }>(requestUrl, currentUserId);
  const [threads, setThreads] = useState<CommunityThread[]>(() => cached?.threads ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [hasMore, setHasMore] = useState(() => {
    const nextCursor = cached?.nextCursor;
    return nextCursor !== undefined ? nextCursor !== null : (cached?.threads?.length ?? 0) >= THREAD_PAGE_SIZE;
  });
  const [loadingMore, setLoadingMore] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ThreadCategory | "all">("all");
  const isVisible = useDocumentVisible();

  const fetchThreads = useCallback(async (background = false, force = false) => {
    if (!background) setLoading(true);
    try {
      const data = await fetchJsonCached<{ threads?: CommunityThread[]; nextCursor?: string | null }>(
        requestUrl,
        { staleMs: THREADS_STALE_MS, force },
        currentUserId,
      );
      setThreads(data.threads ?? []);
      setHasMore(
        data.nextCursor !== undefined
          ? data.nextCursor !== null
          : (data.threads?.length ?? 0) >= THREAD_PAGE_SIZE,
      );
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load threads.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, requestUrl]);

  useEffect(() => {
    if (!isVisible) return;
    const initialFetch = window.setTimeout(() => void fetchThreads(true), 0);

    const room = realtimeRooms.threads(communityId);
    const unsubscribes: Array<() => void> = [];
    const unsubRoom = realtimeClient.subscribe(room);

    // Subscribe to thread changes
    unsubscribes.push(
      realtimeClient.on(room, "thread", () => void fetchThreads(true, true)),
    );

    // Subscribe to like changes for realtime like counts
    unsubscribes.push(
      realtimeClient.on(room, "like", (data) => {
        const record = data as { event?: "INSERT" | "UPDATE" | "DELETE"; thread_id?: string; user_id?: string } | null;
        if (!record?.thread_id) return;
        // Skip own likes — already handled optimistically on click
        if (record.user_id === currentUserId) return;
        const threadId = record.thread_id;

        setThreads((current) =>
          current.map((thread) => {
            if (thread.id !== threadId) return thread;
            if (record.event === "INSERT") {
              return { ...thread, like_count: thread.like_count + 1 };
            }
            if (record.event === "DELETE") {
              return { ...thread, like_count: Math.max(0, thread.like_count - 1) };
            }
            return thread;
          }),
        );
      }),
    );

    realtimeClient.connect();

    return () => {
      window.clearTimeout(initialFetch);
      unsubscribes.forEach((unsub) => unsub());
      unsubRoom();
    };
  }, [communityId, currentUserId, fetchThreads, isVisible]);

  // Refetch on returning to the tab only after a real absence (missed realtime
  // events aren't replayed); brief alt-tabs no longer fire a request each.
  useHiddenCatchUp(() => void fetchThreads(true));

  function writeCache(updater: (prev: CommunityThread[]) => CommunityThread[]) {
    setThreads((prev) => {
      const next = updater(prev);
      patchCachedRequest<{ threads?: CommunityThread[] }>(
        requestUrl,
        (current) => ({ ...current, threads: next }),
        currentUserId,
      );
      return next;
    });
  }

  function handleCreated(thread: CommunityThread) {
    writeCache((cur) => [thread, ...cur.filter((item) => item.id !== thread.id)]);
    onThreadCreated?.(thread);
  }

  function handleUpdated(updated: CommunityThread) {
    writeCache((cur) => cur.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
  }

  function handleLikeChanged(threadId: string, liked: boolean, newCount: number) {
    writeCache((cur) =>
      cur.map((t) => t.id === threadId ? { ...t, user_liked: liked, like_count: newCount } : t),
    );
  }

  function handleSaveChanged(threadId: string, saved: boolean) {
    writeCache((cur) => cur.map((t) => t.id === threadId ? { ...t, user_saved: saved } : t));
  }

  function handleDeleted(threadId: string) {
    writeCache((cur) => cur.filter((t) => t.id !== threadId));
  }

  // ── Load older threads (keyset pagination via ?cursor=createdAt|id) ──────
  async function loadMore() {
    if (loadingMore || !threads.length) return;
    const last = threads[threads.length - 1];
    setLoadingMore(true);
    try {
      const response = await fetch(
        `${requestUrl}?cursor=${encodeURIComponent(`${last.created_at}|${last.id}`)}`,
      );
      if (!response.ok) return;
      const data = await response.json() as { threads?: CommunityThread[]; nextCursor?: string | null };
      writeCache((current) => {
        const byId = new Map(current.map((t) => [t.id, t]));
        for (const thread of data.threads ?? []) byId.set(thread.id, thread);
        return [...byId.values()];
      });
      setHasMore(data.nextCursor !== null && data.nextCursor !== undefined);
    } finally {
      setLoadingMore(false);
    }
  }

  const filteredThreads = filter === "all" ? threads : threads.filter((thread) => thread.category === filter);

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className={`${communityFeedLayout.content} ${!loading && threads.length > 0 ? communityFeedLayout.pageHeaderWithFilters : communityFeedLayout.pageHeader}`}>
        <div className={communityFeedLayout.pageHeaderMain}>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-foreground">Threads</h2>
            <p className="mt-1 max-w-sm text-pretty font-body text-sm leading-5 text-foreground-muted">
              <span className="block">Start a discussion, share an idea, or ask your community</span>
              <span className="block">a question.</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover"
          >
            <Plus size={14} />
            Create Thread
          </button>
        </div>

        {!loading && threads.length > 0 && (
          <div className={`${communityFeedLayout.pageHeaderFilters} flex items-center gap-2 overflow-x-auto pb-1`}>
            {[{ value: "all" as const, label: "All", icon: LayoutGrid }, ...THREAD_CATEGORIES.map((item) => ({
              ...item,
              icon: {
                question: CircleHelp,
                discussion: MessagesSquare,
                idea: Lightbulb,
                feedback: MessageSquareText,
                referral: UserRoundPlus,
                collaboration: UsersRound,
              }[item.value],
            }))].map((item) => {
              const Icon = item.icon;
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
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="font-body text-sm text-red-400">{error}</p>
            <button type="button" onClick={() => void fetchThreads()} className="font-body text-xs text-red-300 underline">
              Try again
            </button>
          </div>
        )}

      </div>

      {loading && (
        <div className={communityFeedLayout.content}>
          <div className="flex items-center justify-center py-24" role="status" aria-label="Loading threads">
            <Spinner size={28} />
          </div>
        </div>
      )}

      {!loading && threads.length === 0 && (
        <div className={communityFeedLayout.content}>
          <div className={communityFeedLayout.emptyState}>
            <MessageSquarePlus size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No threads yet</h3>
            <p className={communityFeedLayout.emptyDescription}>Be the first person to start a discussion.</p>
          </div>
        </div>
      )}

      {!loading && threads.length > 0 && (
        <div className={communityFeedLayout.content}>
          {filteredThreads.length === 0 ? (
            <div className={communityFeedLayout.emptyState}>
              <MessageSquarePlus size={24} className={communityFeedLayout.emptyIcon} />
              <h3 className={communityFeedLayout.emptyTitle}>No threads in this category</h3>
              <p className={communityFeedLayout.emptyDescription}>Try a different filter or start a new thread.</p>
            </div>
          ) : (
            <div className={communityFeedLayout.cardList}>
              {filteredThreads.map((thread, index) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  currentUserId={currentUserId}
                  communityId={communityId}
                  onUpdated={handleUpdated}
                  onLikeChanged={handleLikeChanged}
                  onSaveChanged={handleSaveChanged}
                  onDeleted={handleDeleted}
                  onOpen={() => router.push(`/dashboard/communities/${communityId}/threads/${thread.id}`)}
                />
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
      )}

      {showCreateModal && (
        <CreateThreadModal
          communityId={communityId}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
