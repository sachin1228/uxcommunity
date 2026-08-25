"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, CalendarClock, CalendarDays, CalendarX2, Plus } from "lucide-react";
import { RealtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import type { CommunityEvent } from "./types";
import { CreateEventModal } from "./CreateEventModal";
import { EventCard } from "./EventCard";
import { communityFeedLayout } from "../feed-layout";
import { PostAuthorMeta } from "../PostAuthorMeta";
import { Spinner } from "@/components/ui/Spinner";
import { fetchJsonCached, getCachedRequest, initRequestCache, patchCachedRequest } from "@/lib/request-cache";

const EVENTS_STALE_MS = 60_000;

export function EventsView({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  initRequestCache(currentUserId);
  const requestUrl = `/api/communities/${communityId}/events`;
  const cached = getCachedRequest<{ events?: CommunityEvent[]; nextCursor?: string | null }>(requestUrl, currentUserId);
  const [events, setEvents] = useState<CommunityEvent[]>(() => cached?.events ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(cached?.nextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("all");
  const isVisible = useDocumentVisible();

  const fetchEvents = useCallback(async (background = false, force = false) => {
    if (!background) setLoading(true);
    try {
      const data = await fetchJsonCached<{ events?: CommunityEvent[]; nextCursor?: string | null }>(
        requestUrl,
        { staleMs: EVENTS_STALE_MS, force },
        currentUserId,
      );
      setEvents(data.events ?? []);
      setNextCursor(data.nextCursor ?? null);
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

    const client = new RealtimeClient({
      room: realtimeRooms.events(communityId),
      user: { id: currentUserId, name: null, avatar: null },
    });
    const unsubscribes: Array<() => void> = [];

    unsubscribes.push(client.on("event", () => void fetchEvents(true, true)));
    unsubscribes.push(client.on("rsvp", () => void fetchEvents(true, true)));
    unsubscribes.push(client.on("like", () => void fetchEvents(true, true)));
    unsubscribes.push(client.on("save", () => void fetchEvents(true, true)));

    client.connect();

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      client.close();
    };
  }, [communityId, currentUserId, fetchEvents, isVisible]);

  // Refetch on returning to the tab only after a real absence (missed realtime
  // events aren't replayed); brief alt-tabs no longer fire a request each.
  useHiddenCatchUp(() => void fetchEvents(true));

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
      const next = updater(prev);
      patchCachedRequest<{ events?: CommunityEvent[] }>(
        requestUrl,
        (current) => ({ ...current, events: next }),
        currentUserId,
      );
      return next;
    });
  }

  function handleCreated(event: CommunityEvent) {
    writeCache((prev) => [event, ...prev].sort(
      (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
    ));
  }

  function handleUpdated(updated: CommunityEvent) {
    writeCache((prev) =>
      prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e))
          .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
    );
  }

  function handleDeleted(eventId: string) {
    writeCache((prev) => prev.filter((e) => e.id !== eventId));
  }

  function handleRsvpChanged(eventId: string, rsvped: boolean, count: number) {
    writeCache((prev) => prev.map((e) => e.id === eventId ? { ...e, user_rsvped: rsvped, rsvp_count: count } : e));
  }

  function handleLikeChanged(eventId: string, liked: boolean, count: number) {
    writeCache((prev) => prev.map((e) => e.id === eventId ? { ...e, user_liked: liked, like_count: count } : e));
  }

  function handleSaveChanged(eventId: string, saved: boolean, count: number) {
    writeCache((prev) => prev.map((e) => e.id === eventId ? { ...e, user_saved: saved, save_count: count } : e));
  }

  // Split into upcoming and past
  const now = new Date();
  const upcoming = events.filter((e) => new Date(e.end_date ?? e.event_date) >= now);
  const past = events.filter((e) => new Date(e.end_date ?? e.event_date) < now);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className={`${communityFeedLayout.content} ${!loading && events.length > 0 ? communityFeedLayout.pageHeaderWithFilters : communityFeedLayout.pageHeader}`}>
        <div className={communityFeedLayout.pageHeaderMain}>
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold text-foreground">Events</h2>
            <p className="mt-1 max-w-sm text-pretty font-body text-sm leading-5 text-foreground-muted">
              <span className="block">Community meetups, workshops, and</span>
              <span className="block">get-togethers.</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover"
          >
            <Plus size={14} /> Create Event
          </button>
        </div>

        {!loading && events.length > 0 && (
          <div className={`${communityFeedLayout.pageHeaderFilters} flex items-center gap-2 overflow-x-auto pb-1`}>
            {[
              { value: "all" as const, label: "All events", icon: CalendarDays },
              { value: "upcoming" as const, label: "Upcoming", icon: CalendarClock },
              { value: "past" as const, label: "Past", icon: CalendarCheck2 },
            ].map((item) => {
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
            <CalendarX2 size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No events yet</h3>
            <p className={communityFeedLayout.emptyDescription}>Create the first event for your community.</p>
          </div>
        ) : (filter === "upcoming" && upcoming.length === 0) || (filter === "past" && past.length === 0) ? (
          <div className={communityFeedLayout.emptyState}>
            <CalendarX2 size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No {filter} events</h3>
            <p className={communityFeedLayout.emptyDescription}>Try a different event filter.</p>
          </div>
        ) : (
          <div className={communityFeedLayout.cardList}>
            {[
              ...(filter === "all" || filter === "upcoming" ? upcoming : []),
              ...(filter === "all" || filter === "past" ? past : []),
            ].map((event) => {
              const isPast = new Date(event.end_date ?? event.event_date) < now;

              return (
                <article
                  key={event.id}
                  className={`${communityFeedLayout.card} ${communityFeedLayout.cardInteractive} relative ${isPast ? "opacity-60" : ""}`}
                >
                  <PostAuthorMeta
                    name={event.users?.name}
                    avatarUrl={event.users?.avatar_url}
                    createdAt={event.created_at}
                    dateInline
                    secondaryLabel={`Event · ${event.is_online ? "Online" : event.location ?? "Offline"}`}
                    className="mb-3"
                  />
                  <EventCard
                    event={event}
                    currentUserId={currentUserId}
                    communityId={communityId}
                    onUpdated={handleUpdated}
                    onDeleted={handleDeleted}
                    onRsvpChanged={handleRsvpChanged}
                    onLikeChanged={handleLikeChanged}
                    onSaveChanged={handleSaveChanged}
                    menuInPostHeader
                  />
                </article>
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
    </div>
  );
}
