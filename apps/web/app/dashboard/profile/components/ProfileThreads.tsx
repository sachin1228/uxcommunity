"use client";

import { useEffect, useRef, useState } from "react";
import {
  MessageSquareText,
  CalendarDays,
  BookMarked,
  Bookmark,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { CommunityThread, ProfileThread } from "@/components/communities/threads/types";
import type { CommunityEvent } from "@/components/communities/events/types";
import type { CommunityResource } from "@/components/communities/resources/types";
import { ThreadCard } from "@/components/communities/threads/ThreadCard";
import { EventCard } from "@/components/communities/events/EventCard";
import { ResourceCard } from "@/components/communities/resources/ResourceCard";

type Tab = "threads" | "events" | "resources" | "saved";

type ProfileEvent    = CommunityEvent    & { community: { name: string } | null };
type ProfileResource = CommunityResource & { community: { name: string } | null };

type SavedItem =
  | { type: "thread";   data: ProfileThread }
  | { type: "event";    data: ProfileEvent }
  | { type: "resource"; data: ProfileResource };

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "threads",   label: "Threads",   icon: <MessageSquareText size={13} /> },
  { id: "events",    label: "Events",    icon: <CalendarDays size={13} /> },
  { id: "resources", label: "Resources", icon: <BookMarked size={13} /> },
  { id: "saved",     label: "Saved",     icon: <Bookmark size={13} /> },
];

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center">
      <div className="mx-auto flex justify-center mb-2 text-foreground-subtle">{icon}</div>
      <p className="font-body text-sm text-foreground-muted">{message}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
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
  const [threads, setThreads]     = useState(initialThreads);
  const pendingVotes              = useRef<Set<string>>(new Set());

  // ── Events tab ────────────────────────────────────────────────────────────
  const [events, setEvents]           = useState<ProfileEvent[]>([]);
  const [eventsLoaded, setEventsLoaded]     = useState(false);
  const [eventsLoading, setEventsLoading]   = useState(false);

  // ── Resources tab ─────────────────────────────────────────────────────────
  const [resources, setResources]               = useState<ProfileResource[]>([]);
  const [resourcesLoaded, setResourcesLoaded]   = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(false);

  // ── Saved tab ─────────────────────────────────────────────────────────────
  const [savedItems, setSavedItems]         = useState<SavedItem[]>([]);
  const [savedLoaded, setSavedLoaded]       = useState(false);
  const [savedLoading, setSavedLoading]     = useState(false);

  // Lazy-load events on first visit to that tab
  useEffect(() => {
    if (activeTab !== "events" || eventsLoaded) return;
    setEventsLoading(true);
    fetch("/api/profile/events", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => { setEvents(d.events ?? []); setEventsLoaded(true); })
      .catch(() => setEventsLoaded(true))
      .finally(() => setEventsLoading(false));
  }, [activeTab, eventsLoaded]);

  // Lazy-load resources on first visit to that tab
  useEffect(() => {
    if (activeTab !== "resources" || resourcesLoaded) return;
    setResourcesLoading(true);
    fetch("/api/profile/resources", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { resources: [] }))
      .then((d) => { setResources(d.resources ?? []); setResourcesLoaded(true); })
      .catch(() => setResourcesLoaded(true))
      .finally(() => setResourcesLoading(false));
  }, [activeTab, resourcesLoaded]);

  // Lazy-load saved items on first visit to that tab
  useEffect(() => {
    if (activeTab !== "saved" || savedLoaded) return;
    setSavedLoading(true);
    fetch("/api/profile/saved", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { threads: [], events: [], resources: [] }))
      .then((d) => {
        const items: SavedItem[] = [
          ...(d.threads   ?? []).map((t: ProfileThread)    => ({ type: "thread"   as const, data: t })),
          ...(d.events    ?? []).map((e: ProfileEvent)     => ({ type: "event"    as const, data: e })),
          ...(d.resources ?? []).map((r: ProfileResource)  => ({ type: "resource" as const, data: r })),
        ];
        setSavedItems(items);
        setSavedLoaded(true);
      })
      .catch(() => setSavedLoaded(true))
      .finally(() => setSavedLoading(false));
  }, [activeTab, savedLoaded]);

  // ── Realtime subscriptions for threads ───────────────────────────────────
  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserClient>;
    try { supabase = createBrowserClient(); } catch { return; }

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

  // ── Thread handlers ───────────────────────────────────────────────────────
  function handleUpdated(
    threadId: string,
    community: ProfileThread["community"],
  ): (updated: CommunityThread) => void {
    return (updated: CommunityThread) => {
      setThreads((current) =>
        current.map((t) =>
          t.id === threadId ? ({ ...t, ...updated, community } as ProfileThread) : t,
        ),
      );
    };
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

  function handleSaveChanged(threadId: string, saved: boolean) {
    setThreads((current) =>
      current.map((t) => (t.id === threadId ? { ...t, user_saved: saved } : t)),
    );
  }

  function handleDeleted(threadId: string) {
    setThreads((current) => current.filter((t) => t.id !== threadId));
  }

  // ── Event handlers ────────────────────────────────────────────────────────
  function handleEventUpdated(eventId: string) {
    return (updated: CommunityEvent) =>
      setEvents((current) =>
        current.map((e) => (e.id === eventId ? { ...e, ...updated } : e)),
      );
  }

  function handleEventDeleted(eventId: string) {
    setEvents((current) => current.filter((e) => e.id !== eventId));
  }

  function handleRsvpChanged(eventId: string, rsvped: boolean, count: number) {
    setEvents((current) =>
      current.map((e) =>
        e.id === eventId ? { ...e, user_rsvped: rsvped, rsvp_count: count } : e,
      ),
    );
  }

  // ── Resource handlers ─────────────────────────────────────────────────────
  function handleResourceUpdated(resourceId: string) {
    return (updated: CommunityResource) =>
      setResources((current) =>
        current.map((r) => (r.id === resourceId ? { ...r, ...updated } : r)),
      );
  }

  function handleResourceSaveChanged(resourceId: string, saved: boolean, count: number) {
    setResources((current) =>
      current.map((r) =>
        r.id === resourceId ? { ...r, user_saved: saved, save_count: count } : r,
      ),
    );
  }

  function handleResourceBookmarkChanged(resourceId: string, bookmarked: boolean, count: number) {
    setResources((current) =>
      current.map((r) =>
        r.id === resourceId ? { ...r, user_bookmarked: bookmarked, bookmark_count: count } : r,
      ),
    );
  }

  function handleResourceDeleted(resourceId: string) {
    setResources((current) => current.filter((r) => r.id !== resourceId));
  }

  // ── Patch helper — fills in current user info when author is the viewer ───
  function patchUser<T extends { users: { name: string; avatar_url: string | null } | null }>(item: T): T {
    return {
      ...item,
      users: item.users ?? { name: currentUserName, avatar_url: currentUserAvatar },
    };
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
        {/* ── Threads ── */}
        {activeTab === "threads" && (
          threads.length === 0 ? (
            <EmptyState
              icon={<MessageSquareText size={24} />}
              message="Threads you create will appear here."
            />
          ) : (
            <div className="space-y-3">
              {threads.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={patchUser(thread)}
                  currentUserId={currentUserId}
                  communityId={thread.community_id}
                  communityName={thread.community?.name}
                  onUpdated={handleUpdated(thread.id, thread.community)}
                  onVoteChanged={handleVoteChanged}
                  onSaveChanged={handleSaveChanged}
                  onDeleted={handleDeleted}
                />
              ))}
            </div>
          )
        )}

        {/* ── Events ── */}
        {activeTab === "events" && (
          eventsLoading ? (
            <LoadingState />
          ) : events.length === 0 ? (
            <EmptyState
              icon={<CalendarDays size={24} />}
              message="Events you create in communities will appear here."
            />
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <EventCard
                  key={event.id}
                  event={patchUser(event)}
                  currentUserId={currentUserId}
                  communityId={event.community_id}
                  onUpdated={handleEventUpdated(event.id)}
                  onDeleted={handleEventDeleted}
                  onRsvpChanged={handleRsvpChanged}
                />
              ))}
            </div>
          )
        )}

        {/* ── Resources ── */}
        {activeTab === "resources" && (
          resourcesLoading ? (
            <LoadingState />
          ) : resources.length === 0 ? (
            <EmptyState
              icon={<BookMarked size={24} />}
              message="Resources you share in communities will appear here."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {resources.map((resource) => (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  currentUserId={currentUserId}
                  communityId={resource.community_id}
                  onUpdated={handleResourceUpdated(resource.id)}
                  onSaveChanged={handleResourceSaveChanged}
                  onBookmarkChanged={handleResourceBookmarkChanged}
                  onDeleted={handleResourceDeleted}
                />
              ))}
            </div>
          )
        )}

        {/* ── Saved ── */}
        {activeTab === "saved" && (
          savedLoading ? (
            <LoadingState />
          ) : savedItems.length === 0 ? (
            <EmptyState
              icon={<Bookmark size={24} />}
              message="Events, resources, and threads you save will appear here."
            />
          ) : (
            <div className="space-y-3">
              {savedItems.map((item) => {
                if (item.type === "thread") {
                  const thread = item.data;
                  return (
                    <ThreadCard
                      key={`thread-${thread.id}`}
                      thread={patchUser(thread)}
                      currentUserId={currentUserId}
                      communityId={thread.community_id}
                      communityName={thread.community?.name}
                      onUpdated={handleUpdated(thread.id, thread.community)}
                      onVoteChanged={handleVoteChanged}
                      onSaveChanged={(threadId, saved) => {
                        if (!saved) {
                          setSavedItems((current) =>
                            current.filter((i) => !(i.type === "thread" && i.data.id === threadId)),
                          );
                        }
                        handleSaveChanged(threadId, saved);
                      }}
                      onDeleted={(threadId) => {
                        setSavedItems((current) =>
                          current.filter((i) => !(i.type === "thread" && i.data.id === threadId)),
                        );
                        handleDeleted(threadId);
                      }}
                    />
                  );
                }

                if (item.type === "event") {
                  const event = item.data;
                  return (
                    <EventCard
                      key={`event-${event.id}`}
                      event={patchUser(event)}
                      currentUserId={currentUserId}
                      communityId={event.community_id}
                      onUpdated={(updated) =>
                        setSavedItems((current) =>
                          current.map((i) =>
                            i.type === "event" && i.data.id === event.id
                              ? { ...i, data: { ...i.data, ...updated } }
                              : i,
                          ),
                        )
                      }
                      onDeleted={(eventId) =>
                        setSavedItems((current) =>
                          current.filter((i) => !(i.type === "event" && i.data.id === eventId)),
                        )
                      }
                      onRsvpChanged={(eventId, rsvped, count) =>
                        setSavedItems((current) =>
                          current.map((i) =>
                            i.type === "event" && i.data.id === eventId
                              ? { ...i, data: { ...i.data, user_rsvped: rsvped, rsvp_count: count } }
                              : i,
                          ),
                        )
                      }
                    />
                  );
                }

                if (item.type === "resource") {
                  const resource = item.data;
                  return (
                    <ResourceCard
                      key={`resource-${resource.id}`}
                      resource={resource}
                      currentUserId={currentUserId}
                      communityId={resource.community_id}
                      onUpdated={(updated) =>
                        setSavedItems((current) =>
                          current.map((i) =>
                            i.type === "resource" && i.data.id === resource.id
                              ? { ...i, data: { ...i.data, ...updated } }
                              : i,
                          ),
                        )
                      }
                      onSaveChanged={(resourceId, saved, count) =>
                        setSavedItems((current) =>
                          current.map((i) =>
                            i.type === "resource" && i.data.id === resourceId
                              ? { ...i, data: { ...i.data, user_saved: saved, save_count: count } }
                              : i,
                          ),
                        )
                      }
                      onBookmarkChanged={(resourceId, bookmarked, count) =>
                        // Unbookmarking removes the card from the saved list
                        bookmarked
                          ? setSavedItems((current) =>
                              current.map((i) =>
                                i.type === "resource" && i.data.id === resourceId
                                  ? { ...i, data: { ...i.data, user_bookmarked: true, bookmark_count: count } }
                                  : i,
                              ),
                            )
                          : setSavedItems((current) =>
                              current.filter(
                                (i) => !(i.type === "resource" && i.data.id === resourceId),
                              ),
                            )
                      }
                      onDeleted={(resourceId) =>
                        setSavedItems((current) =>
                          current.filter((i) => !(i.type === "resource" && i.data.id === resourceId)),
                        )
                      }
                    />
                  );
                }

                return null;
              })}
            </div>
          )
        )}
      </div>
    </section>
  );
}
