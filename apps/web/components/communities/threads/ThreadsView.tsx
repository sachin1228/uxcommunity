"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquarePlus, Plus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { CommunityThread } from "./types";
import { CreateThreadModal } from "./CreateThreadModal";
import { ThreadCard } from "./ThreadCard";

// ── Module-level cache (survives tab switches within the same session) ─────────
const threadsCache = new Map<string, { data: CommunityThread[]; fetchedAt: number }>();
const THREADS_STALE_MS = 60_000;

export function ThreadsView({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const cached = threadsCache.get(communityId);
  const [threads, setThreads] = useState<CommunityThread[]>(() => cached?.data ?? []);
  const [loading, setLoading] = useState(() => !cached);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThreads = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const response = await fetch(`/api/communities/${communityId}/threads`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to load threads.");
      const fresh = data.threads as CommunityThread[];
      setThreads(fresh);
      threadsCache.set(communityId, { data: fresh, fetchedAt: Date.now() });
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load threads.");
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    const hit = threadsCache.get(communityId);
    const isStale = !hit || Date.now() - hit.fetchedAt > THREADS_STALE_MS;
    void fetchThreads(!isStale); // background-only when cache is fresh
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
        () => void fetchThreads(true),
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
      supabase.removeChannel(threadChannel);
      supabase.removeChannel(voteChannel);
      document.removeEventListener("visibilitychange", handleFocus);
      window.removeEventListener("focus", handleFocus);
    };
  }, [communityId, currentUserId, fetchThreads]);

  function writeCache(updater: (prev: CommunityThread[]) => CommunityThread[]) {
    setThreads((prev) => {
      const next = updater(prev);
      threadsCache.set(communityId, { data: next, fetchedAt: threadsCache.get(communityId)?.fetchedAt ?? Date.now() });
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">Threads</h2>
            <p className="mt-1 font-body text-sm text-foreground-muted">
              Start a discussion, share an idea, or ask your community a question.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 font-body text-xs font-medium text-accent-foreground hover:bg-accent-hover"
            >
              <Plus size={14} />
              Create Thread
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="font-body text-sm text-red-400">{error}</p>
            <button type="button" onClick={() => void fetchThreads()} className="font-body text-xs text-red-300 underline">
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((item) => (
              <div key={item} className="rounded-2xl border border-border bg-surface p-5">
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
                {/* Divider */}
                <div className="mt-4 border-t border-border" />
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
        ) : threads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <MessageSquarePlus size={28} className="mx-auto text-foreground-subtle" />
            <h3 className="mt-3 font-display text-base font-semibold text-foreground">No threads yet</h3>
            <p className="mt-1 font-body text-sm text-foreground-muted">Be the first person to start a discussion.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {threads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                currentUserId={currentUserId}
                communityId={communityId}
                onUpdated={handleUpdated}
                onVoteChanged={handleVoteChanged}
                onSaveChanged={handleSaveChanged}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </div>

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
