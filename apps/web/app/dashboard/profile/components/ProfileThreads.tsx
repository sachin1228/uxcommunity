"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquareText,
  CalendarDays,
  BookMarked,
  Bookmark,
} from "lucide-react";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { CommunityThread, ProfileThread } from "@/components/communities/threads/types";
import type { CommunityEvent } from "@/components/communities/events/types";
import type { CommunityResource } from "@/components/communities/resources/types";
import type { EventRsvp } from "@/components/communities/events/types";
import { ThreadCard } from "@/components/communities/threads/ThreadCard";
import { EventCard } from "@/components/communities/events/EventCard";
import { ResourceCard } from "@/components/communities/resources/ResourceCard";
import { useGuardedRouter } from "@/lib/navigation-guard";

type Tab = "threads" | "events" | "resources" | "saved";

type SavedItem =
  | { type: "thread";   data: ProfileThread }
  | { type: "event";    data: CommunityEvent }
  | { type: "resource"; data: CommunityResource };

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "threads",   label: "Threads",   icon: <MessageSquareText strokeWidth={2.5} size={13} /> },
  { id: "events",    label: "Events",    icon: <CalendarDays strokeWidth={2.5} size={13} /> },
  { id: "resources", label: "Resources", icon: <BookMarked strokeWidth={2.5} size={13} /> },
  { id: "saved",     label: "Saved",     icon: <Bookmark strokeWidth={2.5} size={13} /> },
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
  const pendingLikes              = useRef<Set<string>>(new Set());
  const isVisible = useDocumentVisible();
  const router = useGuardedRouter();

  // ── Events tab ────────────────────────────────────────────────────────────
  const [events, setEvents]           = useState<CommunityEvent[]>([]);
  const [eventsLoaded, setEventsLoaded]     = useState(false);
  const [eventsLoading, setEventsLoading]   = useState(false);

  // ── Resources tab ─────────────────────────────────────────────────────────
  const [resources, setResources]               = useState<CommunityResource[]>([]);
  const [resourcesLoaded, setResourcesLoaded]   = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(false);

  // ── Saved tab ─────────────────────────────────────────────────────────────
  const [savedItems, setSavedItems]         = useState<SavedItem[]>([]);
  const [savedLoaded, setSavedLoaded]       = useState(false);
  const [savedLoading, setSavedLoading]     = useState(false);

  function mapSavedItems(updater: (current: SavedItem[]) => SavedItem[]) {
    setSavedItems((current) => updater(current));
  }

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
          ...(d.threads   ?? []).map((t: CommunityThread)    => ({ type: "thread"   as const, data: t })),
          ...(d.events    ?? []).map((e: CommunityEvent)     => ({ type: "event"    as const, data: e })),
          ...(d.resources ?? []).map((r: CommunityResource)  => ({ type: "resource" as const, data: r })),
        ];
        setSavedItems(items);
        setSavedLoaded(true);
      })
      .catch(() => setSavedLoaded(true))
      .finally(() => setSavedLoading(false));
  }, [activeTab, savedLoaded]);

  // ── Realtime subscriptions ────────────────────────────────────────────────
  // The profile room receives "thread" / "like" / "poll" events for the
  // owner's threads plus (since the cards must stay in sync everywhere)
  // "event", "rsvp", "save" events for the owner's events and the viewer's
  // saves, and "resource" events for the owner's resources. Interaction
  // counters apply optimistically; content changes refetch that list.
  useEffect(() => {
    if (!isVisible) return;
    const room = realtimeRooms.profile(currentUserId);
    const unsubRoom = realtimeClient.subscribe(room);

    const refetchThreads = async () => {
      try {
        const response = await fetch("/api/profile/threads", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        setThreads(data.threads as ProfileThread[]);
      } catch { /* reconciled on next refresh */ }
    };

    const refetchEvents = async () => {
      if (!eventsLoaded) return;
      try {
        const response = await fetch("/api/profile/events", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        setEvents(data.events ?? []);
      } catch { /* reconciled on next refresh */ }
    };

    const refetchResources = async () => {
      if (!resourcesLoaded) return;
      try {
        const response = await fetch("/api/profile/resources", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        setResources(data.resources ?? []);
      } catch { /* reconciled on next refresh */ }
    };

    const refetchSaved = async () => {
      if (!savedLoaded) return;
      try {
        const response = await fetch("/api/profile/saved", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        const items: SavedItem[] = [
          ...(data.threads   ?? []).map((t: CommunityThread)   => ({ type: "thread"   as const, data: t })),
          ...(data.events    ?? []).map((e: CommunityEvent)    => ({ type: "event"    as const, data: e })),
          ...(data.resources ?? []).map((r: CommunityResource) => ({ type: "resource" as const, data: r })),
        ];
        setSavedItems(items);
      } catch { /* reconciled on next refresh */ }
    };

    const unsubThread = realtimeClient.on(room, "thread", () => {
      void refetchThreads();
      void refetchSaved();
    });

    const unsubPoll = realtimeClient.on(room, "poll", (data) => {
      const record = data as { thread_id?: string; user_id?: string; counts?: number[]; user_vote?: number | null } | null;
      if (!record?.thread_id || !Array.isArray(record.counts)) return;
      if (record.user_id === currentUserId) return;
      setThreads((current) =>
        current.map((thread) =>
          thread.id !== record.thread_id ? thread : { ...thread, poll_vote_counts: record.counts },
        ),
      );
      mapSavedItems((current) =>
        current.map((item) =>
          item.type === "thread" && item.data.id === record.thread_id
            ? { ...item, data: { ...item.data, poll_vote_counts: record.counts } }
            : item,
        ),
      );
    });

    const unsubLike = realtimeClient.on(room, "like", (data) => {
      const record = data as { event?: "INSERT" | "UPDATE" | "DELETE"; thread_id?: string; event_id?: string; user_id?: string } | null;
      const threadId = record?.thread_id;
      const eventId = record?.event_id;
      if (!threadId && !eventId) return;
      if (threadId && record!.user_id === currentUserId && pendingLikes.current.has(threadId)) return;
      const delta = record!.event === "DELETE" ? -1 : 1;
      if (threadId) {
        setThreads((current) =>
          current.map((thread) =>
            thread.id !== threadId ? thread : { ...thread, like_count: Math.max(0, thread.like_count + delta) },
          ),
        );
        mapSavedItems((current) =>
          current.map((item) =>
            item.type === "thread" && item.data.id === threadId
              ? { ...item, data: { ...item.data, like_count: Math.max(0, item.data.like_count + delta) } }
              : item,
          ),
        );
      }
      if (eventId) {
        setEvents((current) =>
          current.map((event) =>
            event.id !== eventId ? event : { ...event, like_count: Math.max(0, event.like_count + delta) },
          ),
        );
        mapSavedItems((current) =>
          current.map((item) =>
            item.type === "event" && item.data.id === eventId
              ? { ...item, data: { ...item.data, like_count: Math.max(0, item.data.like_count + delta) } }
              : item,
          ),
        );
      }
    });

    // Event content changed (create/edit/delete) — refetch both lists.
    const unsubEvent = realtimeClient.on(room, "event", () => {
      void refetchEvents();
      void refetchSaved();
    });

    const unsubRsvp = realtimeClient.on(room, "rsvp", (data) => {
      const record = data as { event?: "INSERT" | "DELETE"; event_id?: string; user_id?: string } | null;
      if (!record?.event_id) return;
      const delta = record.event === "DELETE" ? -1 : 1;
      const apply = (event: CommunityEvent) =>
        event.id === record.event_id
          ? { ...event, rsvp_count: Math.max(0, event.rsvp_count + delta) }
          : event;
      setEvents((current) => current.map(apply));
      mapSavedItems((current) =>
        current.map((item) =>
          item.type === "event" ? { ...item, data: apply(item.data) } : item,
        ),
      );
    });

    const unsubSave = realtimeClient.on(room, "save", (data) => {
      const record = data as { event?: "INSERT" | "DELETE"; event_id?: string; resource_id?: string; user_id?: string } | null;
      if (!record) return;
      // Our own saves were applied optimistically with the exact server count;
      // refetch the saved list so a save made from another surface lands here.
      if (record.user_id === currentUserId) {
        void refetchSaved();
        return;
      }
      const delta = record.event === "DELETE" ? -1 : 1;
      if (record.event_id) {
        const apply = (event: CommunityEvent) =>
          event.id === record.event_id
            ? { ...event, save_count: Math.max(0, event.save_count + delta) }
            : event;
        setEvents((current) => current.map(apply));
        mapSavedItems((current) =>
          current.map((item) =>
            item.type === "event" ? { ...item, data: apply(item.data) } : item,
          ),
        );
      }
      if (record.resource_id) {
        const apply = (resource: CommunityResource) =>
          resource.id === record.resource_id
            ? { ...resource, save_count: Math.max(0, resource.save_count + delta) }
            : resource;
        setResources((current) => current.map(apply));
        mapSavedItems((current) =>
          current.map((item) =>
            item.type === "resource" ? { ...item, data: apply(item.data) } : item,
          ),
        );
      }
    });

    const unsubResource = realtimeClient.on(room, "resource", () => {
      void refetchResources();
      void refetchSaved();
    });

    realtimeClient.connect();
    return () => {
      unsubThread();
      unsubPoll();
      unsubLike();
      unsubEvent();
      unsubRsvp();
      unsubSave();
      unsubResource();
      unsubRoom();
    };
  }, [currentUserId, isVisible, eventsLoaded, resourcesLoaded, savedLoaded]);

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
      mapSavedItems((current) =>
        current.map((item) =>
          item.type === "thread" && item.data.id === threadId
            ? { ...item, data: { ...item.data, ...updated } }
            : item,
        ),
      );
    };
  }

  function handleLikeChanged(threadId: string, liked: boolean, newCount: number) {
    pendingLikes.current.add(threadId);
    setTimeout(() => pendingLikes.current.delete(threadId), 5000);
    setThreads((current) =>
      current.map((t) =>
        t.id === threadId ? { ...t, user_liked: liked, like_count: newCount } : t,
      ),
    );
    mapSavedItems((current) =>
      current.map((item) =>
        item.type === "thread" && item.data.id === threadId
          ? { ...item, data: { ...item.data, user_liked: liked, like_count: newCount } }
          : item,
      ),
    );
  }

  function handleSaveChanged(threadId: string, saved: boolean) {
    setThreads((current) =>
      current.map((t) => (t.id === threadId ? { ...t, user_saved: saved } : t)),
    );
  }

  function handlePollVoteChanged(threadId: string, counts: number[], userVote: number | null, undoUsed: boolean) {
    setThreads((current) =>
      current.map((t) =>
        t.id === threadId ? { ...t, poll_vote_counts: counts, poll_user_vote: userVote, poll_undo_used: undoUsed } : t,
      ),
    );
    mapSavedItems((current) =>
      current.map((item) =>
        item.type === "thread" && item.data.id === threadId
          ? { ...item, data: { ...item.data, poll_vote_counts: counts, poll_user_vote: userVote, poll_undo_used: undoUsed } }
          : item,
      ),
    );
  }

  function handleDeleted(threadId: string) {
    setThreads((current) => current.filter((t) => t.id !== threadId));
    mapSavedItems((current) => current.filter((i) => !(i.type === "thread" && i.data.id === threadId)));
  }

  // Save/unsave from the Threads tab mirrors into the Saved list: unsaving
  // drops the card, saving appends it (when that list is already loaded).
  function handleThreadSaveFromThreadsTab(thread: ProfileThread, saved: boolean) {
    handleSaveChanged(thread.id, saved);
    if (!saved) {
      mapSavedItems((current) => current.filter((i) => !(i.type === "thread" && i.data.id === thread.id)));
    } else {
      mapSavedItems((current) =>
        savedLoaded && !current.some((i) => i.type === "thread" && i.data.id === thread.id)
          ? [...current, { type: "thread" as const, data: { ...thread, user_saved: true } }]
          : current,
      );
    }
  }

  // ── Event handlers ────────────────────────────────────────────────────────
  function handleEventUpdated(eventId: string) {
    return (updated: CommunityEvent) => {
      setEvents((current) =>
        current.map((e) => (e.id === eventId ? { ...e, ...updated } : e)),
      );
      mapSavedItems((current) =>
        current.map((item) =>
          item.type === "event" && item.data.id === eventId
            ? { ...item, data: { ...item.data, ...updated } }
            : item,
        ),
      );
    };
  }

  function handleEventDeleted(eventId: string) {
    setEvents((current) => current.filter((e) => e.id !== eventId));
    mapSavedItems((current) => current.filter((i) => !(i.type === "event" && i.data.id === eventId)));
  }

  function applyEventRsvp(itemId: string, rsvped: boolean, count: number) {
    setEvents((current) =>
      current.map((e) =>
        e.id === itemId ? { ...e, user_rsvped: rsvped, rsvp_count: count } : e,
      ),
    );
    mapSavedItems((current) =>
      current.map((item) =>
        item.type === "event" && item.data.id === itemId
          ? { ...item, data: { ...item.data, user_rsvped: rsvped, rsvp_count: count } }
          : item,
      ),
    );
  }

  function handleEventLikeChanged(eventId: string, liked: boolean, count: number) {
    setEvents((current) =>
      current.map((e) =>
        e.id === eventId ? { ...e, user_liked: liked, like_count: count } : e,
      ),
    );
    mapSavedItems((current) =>
      current.map((item) =>
        item.type === "event" && item.data.id === eventId
          ? { ...item, data: { ...item.data, user_liked: liked, like_count: count } }
          : item,
      ),
    );
  }

  function handleEventSaveChanged(eventId: string, saved: boolean, count: number) {
    setEvents((current) =>
      current.map((e) =>
        e.id === eventId ? { ...e, user_saved: saved, save_count: count } : e,
      ),
    );
    mapSavedItems((current) =>
      current.map((item) =>
        item.type === "event" && item.data.id === eventId
          ? { ...item, data: { ...item.data, user_saved: saved, save_count: count } }
          : item,
      ),
    );
  }

  // Save/unsave from the Events tab mirrors into the Saved list.
  function handleEventSaveFromEventsTab(event: CommunityEvent, saved: boolean, count: number) {
    handleEventSaveChanged(event.id, saved, count);
    if (!saved) {
      mapSavedItems((current) => current.filter((i) => !(i.type === "event" && i.data.id === event.id)));
    } else {
      mapSavedItems((current) =>
        savedLoaded && !current.some((i) => i.type === "event" && i.data.id === event.id)
          ? [...current, { type: "event" as const, data: { ...event, user_saved: true, save_count: count } }]
          : current,
      );
    }
  }

  // The events tab has no per-event realtime preview channel, so the attendee
  // avatar stacks must be refetched once an RSVP settles — otherwise the
  // current user's avatar never appears until the next full load.
  const handleEventRsvpSettled = useCallback(async (event: CommunityEvent) => {
    if (!event.community_id) return;
    try {
      const response = await fetch(
        `/api/communities/${event.community_id}/events/${event.id}/rsvp/list`,
      );
      if (!response.ok) return;
      const data = await response.json() as { rsvps?: EventRsvp[] };
      const rsvps = data.rsvps ?? [];
      setEvents((current) =>
        current.map((e) => (e.id === event.id ? { ...e, rsvps } : e)),
      );
      mapSavedItems((current) =>
        current.map((item) =>
          item.type === "event" && item.data.id === event.id
            ? { ...item, data: { ...item.data, rsvps } }
            : item,
        ),
      );
    } catch {
      // Non-fatal — previews catch up on the next list fetch.
    }
  }, []);

  // ── Resource handlers ─────────────────────────────────────────────────────
  function handleResourceUpdated(resourceId: string) {
    return (updated: CommunityResource) => {
      setResources((current) =>
        current.map((r) => (r.id === resourceId ? { ...r, ...updated } : r)),
      );
      mapSavedItems((current) =>
        current.map((item) =>
          item.type === "resource" && item.data.id === resourceId
            ? { ...item, data: { ...item.data, ...updated } }
            : item,
        ),
      );
    };
  }

  function handleResourceSaveChanged(resourceId: string, saved: boolean, count: number) {
    setResources((current) =>
      current.map((r) =>
        r.id === resourceId ? { ...r, user_saved: saved, save_count: count } : r,
      ),
    );
    mapSavedItems((current) =>
      current.map((item) =>
        item.type === "resource" && item.data.id === resourceId
          ? { ...item, data: { ...item.data, user_saved: saved, save_count: count } }
          : item,
      ),
    );
  }

  function handleResourceBookmarkChanged(resourceId: string, bookmarked: boolean, count: number) {
    setResources((current) =>
      current.map((r) =>
        r.id === resourceId ? { ...r, user_bookmarked: bookmarked, bookmark_count: count } : r,
      ),
    );
    mapSavedItems((current) =>
      current.map((item) =>
        item.type === "resource" && item.data.id === resourceId
          ? { ...item, data: { ...item.data, user_bookmarked: bookmarked, bookmark_count: count } }
          : item,
      ),
    );
  }

  function handleResourceDeleted(resourceId: string) {
    setResources((current) => current.filter((r) => r.id !== resourceId));
    mapSavedItems((current) => current.filter((i) => !(i.type === "resource" && i.data.id === resourceId)));
  }

  // Bookmark/unbookmark from the Resources tab mirrors into the Saved list
  // (bookmarks are what the Saved list is built from).
  function handleResourceBookmarkFromResourcesTab(resource: CommunityResource, bookmarked: boolean, count: number) {
    handleResourceBookmarkChanged(resource.id, bookmarked, count);
    if (!bookmarked) {
      mapSavedItems((current) => current.filter((i) => !(i.type === "resource" && i.data.id === resource.id)));
    } else {
      mapSavedItems((current) =>
        savedLoaded && !current.some((i) => i.type === "resource" && i.data.id === resource.id)
          ? [...current, { type: "resource" as const, data: { ...resource, user_bookmarked: true, bookmark_count: count } }]
          : current,
      );
    }
  }

  // ── Patch helper — fills in the viewer's info only when the author row is
  // genuinely missing (deleted accounts); real authors are served by the API
  // so saved items show whoever actually wrote the post. ──
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
              icon={<MessageSquareText strokeWidth={2.5} size={24} />}
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
                  communityImage={thread.community?.image_url}
                  communityNamePlacement="below"
                  onUpdated={handleUpdated(thread.id, thread.community)}
                  onLikeChanged={handleLikeChanged}
                  onSaveChanged={(threadId, saved) => handleThreadSaveFromThreadsTab(thread, saved)}
                  onPollVoteChanged={handlePollVoteChanged}
                  onDeleted={handleDeleted}
                  onOpen={() => router.push(`/dashboard/communities/${thread.community_id}/threads/${thread.id}`)}
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
              icon={<CalendarDays strokeWidth={2.5} size={24} />}
              message="Events you create in communities will appear here."
            />
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={patchUser(event)}
                    rsvps={event.rsvps}
                    currentUserId={currentUserId}
                    communityId={event.community_id}
                    communityName={event.community?.name}
                    communityImage={event.community?.image_url}
                    onOpen={() => router.push(`/dashboard/communities/${event.community_id}/events/${event.id}`)}
                    onUpdated={handleEventUpdated(event.id)}
                    onDeleted={handleEventDeleted}
                    onRsvpChanged={applyEventRsvp}
                    onRsvpSettled={() => handleEventRsvpSettled(event)}
                    onLikeChanged={handleEventLikeChanged}
                    onSaveChanged={(eventId, saved, count) => handleEventSaveFromEventsTab(event, saved, count)}
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
              icon={<BookMarked strokeWidth={2.5} size={24} />}
              message="Resources you share in communities will appear here."
            />
          ) : (
            <div className="space-y-3">
              {resources.map((resource) => (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  currentUserId={currentUserId}
                  communityId={resource.community_id}
                  communityName={resource.community?.name}
                  communityImage={resource.community?.image_url}
                  onUpdated={handleResourceUpdated(resource.id)}
                  onSaveChanged={handleResourceSaveChanged}
                  onBookmarkChanged={(resourceId, bookmarked, count) => handleResourceBookmarkFromResourcesTab(resource, bookmarked, count)}
                  onDeleted={handleResourceDeleted}
                  onOpen={() => router.push(`/dashboard/communities/${resource.community_id}/resources/${resource.id}`)}
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
              icon={<Bookmark strokeWidth={2.5} size={24} />}
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
                      communityImage={thread.community?.image_url}
                      communityNamePlacement="below"
                      onUpdated={handleUpdated(thread.id, thread.community)}
                      onLikeChanged={handleLikeChanged}
                      onSaveChanged={(threadId, saved) => {
                        if (!saved) {
                          mapSavedItems((current) =>
                            current.filter((i) => !(i.type === "thread" && i.data.id === threadId)),
                          );
                        }
                        handleSaveChanged(threadId, saved);
                      }}
                      onPollVoteChanged={handlePollVoteChanged}
                      onDeleted={handleDeleted}
                      onOpen={() => router.push(`/dashboard/communities/${thread.community_id}/threads/${thread.id}`)}
                    />
                  );
                }

                if (item.type === "event") {
                  const event = item.data;
                  return (
                    <EventCard
                      key={`event-${event.id}`}
                      event={patchUser(event)}
                      rsvps={event.rsvps}
                      currentUserId={currentUserId}
                      communityId={event.community_id}
                      communityName={event.community?.name}
                      communityImage={event.community?.image_url}
                      onOpen={() => router.push(`/dashboard/communities/${event.community_id}/events/${event.id}`)}
                      onUpdated={handleEventUpdated(event.id)}
                      onDeleted={handleEventDeleted}
                      onRsvpChanged={applyEventRsvp}
                      onRsvpSettled={() => handleEventRsvpSettled(event)}
                      onLikeChanged={handleEventLikeChanged}
                      onSaveChanged={(eventId, saved, count) => {
                        if (!saved) {
                          mapSavedItems((current) =>
                            current.filter((i) => !(i.type === "event" && i.data.id === eventId)),
                          );
                        }
                        handleEventSaveChanged(eventId, saved, count);
                      }}
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
                      communityName={resource.community?.name}
                      communityImage={resource.community?.image_url}
                      onUpdated={handleResourceUpdated(resource.id)}
                      onSaveChanged={(resourceId, saved, count) => {
                        if (!saved) {
                          mapSavedItems((current) =>
                            current.filter((i) => !(i.type === "resource" && i.data.id === resourceId)),
                          );
                        }
                        handleResourceSaveChanged(resourceId, saved, count);
                      }}
                      onBookmarkChanged={(resourceId, bookmarked, count) => {
                        // Unbookmarking removes the card from the saved list.
                        if (!bookmarked) {
                          mapSavedItems((current) =>
                            current.filter((i) => !(i.type === "resource" && i.data.id === resourceId)),
                          );
                        }
                        handleResourceBookmarkChanged(resourceId, bookmarked, count);
                      }}
                      onDeleted={handleResourceDeleted}
                      onOpen={() => router.push(`/dashboard/communities/${resource.community_id}/resources/${resource.id}`)}
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
