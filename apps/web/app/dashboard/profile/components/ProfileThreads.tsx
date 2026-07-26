"use client";

import { useEffect, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { ProfileThread } from "@/components/communities/threads/types";
import { ProfileThreadCard } from "@/components/communities/threads/ProfileThreadCard";

export function ProfileThreads({
  initialThreads,
  currentUserId,
}: {
  initialThreads: ProfileThread[];
  currentUserId: string;
}) {
  const [threads, setThreads] = useState(initialThreads);

  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    const threadChannel = supabase
      .channel("profile-threads")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "community_threads",
        },
        async () => {
          try {
            const response = await fetch("/api/profile/threads", { cache: "no-store" });
            if (!response.ok) return;
            const data = await response.json();
            setThreads(data.threads as ProfileThread[]);
          } catch {
            // The next profile refresh will reconcile the list.
          }
        },
      )
      .subscribe();

    const voteChannel = supabase
      .channel("profile-thread-votes")
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

    return () => {
      supabase.removeChannel(threadChannel);
      supabase.removeChannel(voteChannel);
    };
  }, [currentUserId]);

  function handleUpdated(updated: ProfileThread) {
    setThreads((current) =>
      current.map((thread) => (thread.id === updated.id ? { ...thread, ...updated } : thread)),
    );
  }

  function handleVoteChanged(threadId: string, voted: boolean, newCount: number) {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId ? { ...thread, user_voted: voted, vote_count: newCount } : thread,
      ),
    );
  }

  return (
    <section className="mb-8 rounded-2xl border border-border bg-surface p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="rounded bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-bold text-accent">
          04
        </span>
        <span className="font-display text-xs font-semibold uppercase tracking-widest text-foreground-muted">
          Your Threads
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {threads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
          <MessageSquareText size={24} className="mx-auto text-foreground-subtle" />
          <p className="mt-2 font-body text-sm text-foreground-muted">
            Threads you create will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {threads.map((thread) => (
            <ProfileThreadCard
              key={thread.id}
              thread={thread}
              onUpdated={handleUpdated}
              onVoteChanged={handleVoteChanged}
            />
          ))}
        </div>
      )}
    </section>
  );
}
