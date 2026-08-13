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
import { createBrowserClient } from "@/lib/supabase/browser";
import { THREAD_CATEGORIES, type CommunityThread, type ThreadCategory } from "./types";
import { CreateThreadModal } from "./CreateThreadModal";
import { ThreadCard } from "./ThreadCard";
import { communityFeedLayout } from "../feed-layout";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";

const THREADS_STALE_MS = 60_000;

export function ThreadsView({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  initRequestCache(currentUserId);
  const requestUrl = `/api/communities/${communityId}/threads`;
  const cached = getCachedRequest<{ threads?: CommunityThread[] }>(requestUrl, currentUserId);
  const [threads, setThreads] = useState<CommunityThread[]>(() => cached?.threads ?? []);
  const [loading, setLoading] = useState(() => !cached);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ThreadCategory | "all">("all");

  const fetchThreads = useCallback(async (background = false, force = false) => {
    if (!background) setLoading(true);
    try {
      const data = await fetchJsonCached<{ threads?: CommunityThread[] }>(
        requestUrl,
        { staleMs: THREADS_STALE_MS, force },
        currentUserId,
      );
      setThreads(data.threads ?? []);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load threads.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, requestUrl]);

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void fetchThreads(true), 0);
    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    // Subscribe to thread changes
    const threadChannel = supabase
      .channel(`community-threads:${communityId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "community_threads",
          filter: `community_id=eq.${communityId}`,
        },
        () => void fetchThreads(true, true),
      )
      .subscribe();

    // Subscribe to vote changes for realtime vote counts
    const voteChannel = supabase
      .channel(`thread-votes:${communityId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "thread_votes",
        },
        (payload) => {
          const record = (payload.new ?? payload.old) as { thread_id?: string; user_id?: string } | null;
          if (!record?.thread_id) return;
          // Skip own votes — already handled optimistically on click
          if (record.user_id === currentUserId) return;
          const threadId = record.thread_id;

          setThreads((current) =>
            current.map((thread) => {
              if (thread.id !== threadId) return thread;
              if (payload.eventType === "INSERT") {
                return { ...thread, vote_count: thread.vote_count + 1 };
              }
              if (payload.eventType === "DELETE") {
                return { ...thread, vote_count: Math.max(0, thread.vote_count - 1) };
              }
              return thread;
            }),
          );
        },
      )
      .subscribe();

    const handleFocus = () => {
      if (document.visibilityState === "visible") void fetchThreads(true);
    };
    document.addEventListener("visibilitychange", handleFocus);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearTimeout(initialFetch);
      supabase.removeChannel(threadChannel);
      supabase.removeChannel(voteChannel);
      document.removeEventListener("visibilitychange", handleFocus);
      window.removeEventListener("focus", handleFocus);
    };
  }, [communityId, currentUserId, fetchThreads]);

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
  }

  function handleUpdated(updated: CommunityThread) {
    writeCache((cur) => cur.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
  }

  function handleVoteChanged(threadId: string, voted: boolean, newCount: number) {
    writeCache((cur) =>
      cur.map((t) => t.id === threadId ? { ...t, user_voted: voted, vote_count: newCount } : t),
    );
  }

  function handleSaveChanged(threadId: string, saved: boolean) {
    writeCache((cur) => cur.map((t) => t.id === threadId ? { ...t, user_saved: saved } : t));
  }

  function handleDeleted(threadId: string) {
    writeCache((cur) => cur.filter((t) => t.id !== threadId));
  }

  const filteredThreads = filter === "all" ? threads : threads.filter((thread) => thread.category === filter);

  return (
    <div className="flex-1 overflow-y-auto">
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
          <div className={communityFeedLayout.skeletonList}>
            {[1, 2, 3].map((item) => (
              <div key={item} className={communityFeedLayout.skeletonRow}>
                {/* Top row: avatar + name + category */}
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 shrink-0 rounded-full bg-surface-raised" />
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-20 rounded bg-surface-raised" />
                    <div className="h-3 w-10 rounded bg-surface-raised" />
                    <div className="h-5 w-16 rounded-full bg-surface-raised" />
                  </div>
                </div>
                {/* Title */}
                <div className="mt-4 h-5 w-3/4 rounded bg-surface-raised" />
                {/* Description */}
                <div className="mt-2 space-y-1.5">
                  <div className="h-3 w-full rounded bg-surface-raised" />
                  <div className="h-3 w-4/5 rounded bg-surface-raised" />
                  <div className="h-3 w-2/3 rounded bg-surface-raised" />
                </div>
                {/* Tags */}
                <div className="mt-3 flex gap-2">
                  <div className="h-6 w-16 rounded-lg bg-surface-raised" />
                  <div className="h-6 w-20 rounded-lg bg-surface-raised" />
                </div>
                {/* Footer */}
                <div className="mt-3 flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-surface-raised" />
                    <div className="h-3 w-6 rounded bg-surface-raised" />
                  </div>
                  <div className="h-3 w-20 rounded bg-surface-raised" />
                </div>
              </div>
            ))}
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
          ) : filteredThreads.map((thread, index) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              currentUserId={currentUserId}
              communityId={communityId}
              onUpdated={handleUpdated}
              onVoteChanged={handleVoteChanged}
              onSaveChanged={handleSaveChanged}
              onDeleted={handleDeleted}
              isLast={index === filteredThreads.length - 1}
            />
          ))}
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
