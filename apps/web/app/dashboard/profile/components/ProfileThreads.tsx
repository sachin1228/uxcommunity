"use client";

import { useEffect, useRef, useState } from "react";
import {
  MessageSquareText,
  LayoutGrid,
  CalendarDays,
  BookMarked,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { ProfileThread } from "@/components/communities/threads/types";
import { ProfileThreadCard } from "@/components/communities/threads/ProfileThreadCard";

type Tab = "threads" | "showcase" | "events" | "resources";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "threads",   label: "Threads",   icon: <MessageSquareText size={13} /> },
  { id: "showcase",  label: "Showcase",  icon: <LayoutGrid size={13} /> },
  { id: "events",    label: "Events",    icon: <CalendarDays size={13} /> },
  { id: "resources", label: "Resources", icon: <BookMarked size={13} /> },
];

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center">
      <div className="mx-auto flex justify-center mb-2 text-foreground-subtle">{icon}</div>
      <p className="font-body text-sm text-foreground-muted">{message}</p>
    </div>
  );
}

export function ProfileThreads({
  initialThreads,
  currentUserId,
  currentUserName,
  currentUserAvatar,
}: {
  initialThreads: ProfileThread[];
  currentUserId: string;
  currentUserName: string;
  currentUserAvatar: string | null;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("threads");
  const [threads, setThreads] = useState(initialThreads);
  const pendingVotes = useRef<Set<string>>(new Set());

  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    const threadChannel = supabase
      .channel("profile-threads")
      .on("postgres_changes", { event: "*", schema: "public", table: "community_threads" }, async () => {
        try {
          const response = await fetch("/api/profile/threads", { cache: "no-store" });
          if (!response.ok) return;
          const data = await response.json();
          setThreads(data.threads as ProfileThread[]);
        } catch { /* reconciled on next refresh */ }
      })
      .subscribe();

    const voteChannel = supabase
      .channel("profile-thread-votes")
      .on("postgres_changes", { event: "*", schema: "public", table: "thread_votes" }, (payload) => {
        const record = (payload.new ?? payload.old) as { thread_id?: string; user_id?: string } | null;
        if (!record?.thread_id) return;
        const threadId = record.thread_id;
        if (record.user_id === currentUserId && pendingVotes.current.has(threadId)) return;
        setThreads((current) =>
          current.map((thread) => {
            if (thread.id !== threadId) return thread;
            if (payload.eventType === "INSERT") return { ...thread, vote_count: thread.vote_count + 1 };
            if (payload.eventType === "DELETE") return { ...thread, vote_count: Math.max(0, thread.vote_count - 1) };
            return thread;
          }),
        );
      })
      .subscribe();

    return () => {
      supabase.removeChannel(threadChannel);
      supabase.removeChannel(voteChannel);
    };
  }, [currentUserId]);

  function handleUpdated(updated: ProfileThread) {
    setThreads((current) =>
      current.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
    );
  }

  function handleVoteChanged(threadId: string, voted: boolean, newCount: number) {
    pendingVotes.current.add(threadId);
    setTimeout(() => pendingVotes.current.delete(threadId), 5000);
    setThreads((current) =>
      current.map((t) =>
        t.id === threadId ? { ...t, user_voted: voted, vote_count: newCount } : t,
      ),
    );
  }

  function handleDeleted(threadId: string) {
    setThreads((current) => current.filter((t) => t.id !== threadId));
  }

  return (
    <section className="">

      {/* Tab bar */}
      <div className="flex border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-3.5 font-body text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-accent text-accent"
                : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="pt-5">
        {activeTab === "threads" && (
          threads.length === 0 ? (
            <EmptyState
              icon={<MessageSquareText size={24} />}
              message="Threads you create will appear here."
            />
          ) : (
            <div className="space-y-3">
              {threads.map((thread) => (
                <ProfileThreadCard
                  key={thread.id}
                  thread={thread}
                  currentUserName={currentUserName}
                  currentUserAvatar={currentUserAvatar}
                  onUpdated={handleUpdated}
                  onVoteChanged={handleVoteChanged}
                  onDeleted={handleDeleted}
                />
              ))}
            </div>
          )
        )}

        {activeTab === "showcase" && (
          <EmptyState
            icon={<LayoutGrid size={24} />}
            message="Your showcase work will appear here."
          />
        )}

        {activeTab === "events" && (
          <EmptyState
            icon={<CalendarDays size={24} />}
            message="Events you're attending or hosting will appear here."
          />
        )}

        {activeTab === "resources" && (
          <EmptyState
            icon={<BookMarked size={24} />}
            message="Resources you've shared will appear here."
          />
        )}
      </div>
    </section>
  );
}
