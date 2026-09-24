"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CalendarCheck2, CalendarX2, Plus } from "lucide-react";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import type { CommunityEvent } from "./types";
import { CreateEventModal } from "./CreateEventModal";
import { EventCard } from "./EventCard";
import { EventGroupCreatedModal } from "./EventGroupCreatedModal";
import { communityFeedLayout } from "../feed-layout";
import { filterChip } from "../filter-chip";
import { Spinner } from "@/components/ui/Spinner";
import { GradientButton } from "@/components/ui/GradientButton";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { invalidateCommunitiesList, notifyContentEvent } from "@/lib/communities/cache";
import { applyContentChanges, publishContentChange } from "@/lib/communities/content-sync";
import { useContentChanges } from "@/lib/communities/use-content-changes";

const EVENTS_STALE_MS = 60_000;

function mergeUniqueEvents(events: CommunityEvent[]) {
  const byId = new Map<string, CommunityEvent>();
  for (const event of events) {
    byId.set(event.id, event);
  }
  return [...byId.values()];
}

export function EventsView({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  initRequestCache(currentUserId);
  const router = useGuardedRouter();
  const requestUrl = `/api/communities/${communityId}/events`;
  const cached = getCachedRequest<{ events?: CommunityEvent[]; nextCursor?: string | null }>(requestUrl, currentUserId);
  const [events, setEvents] = useState<CommunityEvent[]>(() => cached?.events ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [showCreateModal, setShowCreateModal] = useState(false);
  /** The room a just-created event came with, announced once (see the modal). */
  const [createdGroup, setCreatedGroup] = useState<{
    title: string;
    eventDate: string;
    chatCommunityId: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(cached?.nextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<"upcoming" | "past">("upcoming");
  const isVisible = useDocumentVisible();

  const fetchEvents = useCallback(async (background = false, force = false) => {
    if (!background) setLoading(true);
    try {
      const [upcomingData, pastData] = await Promise.all([
        fetchJsonCached<{ events?: CommunityEvent[]; nextCursor?: string | null }>(
          requestUrl,
          { staleMs: EVENTS_STALE_MS, force },
          currentUserId,
        ),
        fetchJsonCached<{ events?: CommunityEvent[]; nextCursor?: string | null }>(
          `${requestUrl}?cursor=past`,
          { staleMs: EVENTS_STALE_MS, force },
          currentUserId,
        ),
      ]);
      const allEvents = mergeUniqueEvents([...(upcomingData.events ?? []), ...(pastData.events ?? [])]);
      setEvents(allEvents);
      setNextCursor(allEvents.length > 25 ? upcomingData.nextCursor ?? null : null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, requestUrl]);

  useEffect(() => {
    if (!isVisible) return;
    queueMicrotask(() => void fetchEvents(true));

    const room = realtimeRooms.events(communityId);
    const unsubscribes: Array<() => void> = [];
    const unsubRoom = realtimeClient.subscribe(room);

    unsubscribes.push(realtimeClient.on(room, "event", () => void fetchEvents(true, true)));
    unsubscribes.push(realtimeClient.on(room, "rsvp", () => void fetchEvents(true, true)));
    unsubscribes.push(realtimeClient.on(room, "like", () => void fetchEvents(true, true)));
    unsubscribes.push(
      realtimeClient.on(room, "save", (data) => {
        const record = data as { user_id?: string } | null;
        // Our own save was already applied optimistically with the exact count
        // the route returned. Refetching both event pages for it would stall
        // the tab behind two fresh requests for no new information.
        if (record?.user_id === currentUserId) return;
        void fetchEvents(true, true);
      }),
    );

    realtimeClient.connect();

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      unsubRoom();
    };
  }, [communityId, currentUserId, fetchEvents, isVisible]);

  // Refetch on returning to the tab only after a real absence (missed realtime
  // events aren't replayed); brief alt-tabs no longer fire a request each.
  useHiddenCatchUp(() => void fetchEvents(true));

  // RSVPs, likes, saves and edits made anywhere else are merged in place.
  useContentChanges("event", (changes) => {
    writeCache((current) => applyContentChanges(current, changes, "event"));
  });

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`${requestUrl}?cursor=${encodeURIComponent(nextCursor)}`);
      if (!response.ok) throw new Error();
      const data = await response.json() as { events?: CommunityEvent[]; nextCursor?: string | null };
      setEvents((current) => {
        const byId = new Map(current.map((event) => [event.id, event]));
        for (const event of data.events ?? []) byId.set(event.id, event);
        return [...byId.values()];
      });
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setError("Failed to load more events.");
    } finally {
      setLoadingMore(false);
    }
  }

  function writeCache(updater: (prev: CommunityEvent[]) => CommunityEvent[]) {
    setEvents((prev) => {
      const next = mergeUniqueEvents(updater(prev));
      patchCachedRequest<{ events?: CommunityEvent[] }>(
        requestUrl,
        (current) => ({ ...current, events: next }),
        currentUserId,
      );
      return next;
    });
  }

  function handleCreated(event: CommunityEvent, chatCommunityId: string | null) {
    writeCache((prev) => [event, ...prev].sort(
      (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
    ));
    publishContentChange({ kind: "event", id: event.id, created: true });
    // Mirror into the chat timeline as a permanent "You created an event" card.
    notifyContentEvent({
      kind: "insert",
      event: {
        id: event.id,
        community_id: event.community_id,
        user_id: event.user_id,
        kind: "event",
        title: event.title,
        created_at: event.created_at,
        meta: {
          image_url: event.cover_image_url,
          description: event.description,
          event_date: event.event_date,
          end_date: event.end_date,
          is_online: event.is_online,
          rsvp_count: 0,
        },
      },
    });
    // Creating an event also creates its group chat and puts the creator in it
    // (see lib/communities/event-chat), so the sidebar has to pick the new room
    // up instead of waiting for its next refetch — it lands pinned at the top,
    // which is exactly what the announcement below explains.
    invalidateCommunitiesList();
    if (chatCommunityId) {
      setCreatedGroup({
        title: event.title,
        eventDate: event.event_date,
        chatCommunityId,
      });
    }
  }

  function handleUpdated(updated: CommunityEvent) {
    writeCache((prev) =>
      prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e))
          .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
    );
    publishContentChange({
      kind: "event",
      id: updated.id,
      patch: updated as unknown as Record<string, unknown>,
    });
  }

  function handleDeleted(eventId: string) {
    writeCache((prev) => prev.filter((e) => e.id !== eventId));
    publishContentChange({ kind: "event", id: eventId, removed: true });
    // Drop the chat timeline's permanent "created an event" card too.
    notifyContentEvent({ kind: "delete", event: { id: eventId, community_id: communityId, kind: "event" } });
  }

  function handleRsvpChanged(eventId: string, rsvped: boolean, count: number) {
    writeCache((prev) => prev.map((e) => e.id === eventId ? { ...e, user_rsvped: rsvped, rsvp_count: count } : e));
    publishContentChange({ kind: "event", id: eventId, patch: { user_rsvped: rsvped, rsvp_count: count } });
  }

  function handleLikeChanged(eventId: string, liked: boolean, count: number) {
    writeCache((prev) => prev.map((e) => e.id === eventId ? { ...e, user_liked: liked, like_count: count } : e));
    publishContentChange({ kind: "event", id: eventId, patch: { user_liked: liked, like_count: count } });
  }

  function handleSaveChanged(eventId: string, saved: boolean, count: number) {
    writeCache((prev) => prev.map((e) => e.id === eventId ? { ...e, user_saved: saved, save_count: count } : e));
    publishContentChange({ kind: "event", id: eventId, patch: { user_saved: saved, save_count: count } });
  }

  // Split into upcoming and past
  const now = new Date();
  const upcoming = events.filter((e) => new Date(e.end_date ?? e.event_date) >= now);
  const past = events.filter((e) => new Date(e.end_date ?? e.event_date) < now);

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className={`${communityFeedLayout.content} ${!loading && events.length > 0 ? communityFeedLayout.pageHeaderWithFilters : communityFeedLayout.pageHeader}`}>
        <div className={communityFeedLayout.pageHeaderMain}>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-foreground">Events</h2>
            <p className="mt-1 max-w-sm text-pretty font-body text-sm leading-5 text-foreground-muted">
              <span className="block">Community meetups, workshops, and</span>
              <span className="block">get-togethers.</span>
            </p>
          </div>
          <GradientButton onClick={() => setShowCreateModal(true)}>
            <Plus strokeWidth={2.5} size={14} /> Create Event
          </GradientButton>
        </div>

        {!loading && events.length > 0 && (
          <div className={`${communityFeedLayout.pageHeaderFilters} flex items-center gap-2 overflow-x-auto pb-1`}>
            {[
              { value: "upcoming" as const, label: "Upcoming", icon: CalendarClock, count: upcoming.length },
              { value: "past" as const, label: "Past", icon: CalendarCheck2, count: past.length },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  aria-pressed={filter === item.value}
                  className={filterChip(filter === item.value)}
                >
                  <Icon size={14} strokeWidth={2.5} aria-hidden="true" />
                  {item.label} ({item.count})
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="font-body text-sm text-red-400">{error}</p>
            <button type="button" onClick={() => void fetchEvents()} className="font-body text-xs text-red-300 underline">Try again</button>
          </div>
        )}

      </div>

      <div className={communityFeedLayout.content}>
        {loading ? (
          <div className="flex items-center justify-center py-24" aria-label="Loading events" role="status">
            <Spinner size={28} />
          </div>
        ) : events.length === 0 ? (
          <div className={communityFeedLayout.emptyState}>
            <CalendarX2 strokeWidth={2.5} size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No events yet</h3>
            <p className={communityFeedLayout.emptyDescription}>Create the first event for your community.</p>
          </div>
        ) : (filter === "upcoming" && upcoming.length === 0) || (filter === "past" && past.length === 0) ? (
          <div className={communityFeedLayout.emptyState}>
            <CalendarX2 strokeWidth={2.5} size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No {filter} events</h3>
            <p className={communityFeedLayout.emptyDescription}>Try a different event filter.</p>
          </div>
        ) : (
          <div className={communityFeedLayout.cardList}>
            {(filter === "upcoming" ? upcoming : past).map((event) => {
              const isPast = new Date(event.end_date ?? event.event_date) < now;

              return (
                <div key={event.id} className={isPast ? "opacity-60" : ""}>
                  <EventCard
                    event={event}
                    currentUserId={currentUserId}
                    communityId={communityId}
                    onUpdated={handleUpdated}
                    onDeleted={handleDeleted}
                    onRsvpChanged={handleRsvpChanged}
                    onLikeChanged={handleLikeChanged}
                    onSaveChanged={handleSaveChanged}
                    onOpen={() => router.push(`/dashboard/communities/${communityId}/events/${event.id}`)}
                  />
                </div>
              );
            })}
            {nextCursor && (
              <div className="flex justify-center py-6">
                <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="rounded-lg border border-border px-4 py-2 font-body text-sm text-foreground hover:bg-surface-raised disabled:opacity-60">
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateEventModal
          communityId={communityId}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}

      {createdGroup && (
        <EventGroupCreatedModal
          eventTitle={createdGroup.title}
          eventDate={createdGroup.eventDate}
          chatCommunityId={createdGroup.chatCommunityId}
          onClose={() => setCreatedGroup(null)}
        />
      )}
    </div>
  );
}
