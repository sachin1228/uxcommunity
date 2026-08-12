"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, CalendarClock, CalendarDays, CalendarX2, Plus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { CommunityEvent } from "./types";
import { CreateEventModal } from "./CreateEventModal";
import { EventCard } from "./EventCard";
import { communityFeedLayout } from "../feed-layout";

// ── Module-level cache ────────────────────────────────────────────────────────
const eventsCache = new Map<string, { data: CommunityEvent[]; fetchedAt: number }>();
const EVENTS_STALE_MS = 60_000;

export function EventsView({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const cached = eventsCache.get(communityId);
  const [events, setEvents] = useState<CommunityEvent[]>(() => cached?.data ?? []);
  const [loading, setLoading] = useState(() => !cached);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("all");

  const fetchEvents = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/events`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load events.");
      const fresh = data.events as CommunityEvent[];
      setEvents(fresh);
      eventsCache.set(communityId, { data: fresh, fetchedAt: Date.now() });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events.");
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    const hit = eventsCache.get(communityId);
    const isStale = !hit || Date.now() - hit.fetchedAt > EVENTS_STALE_MS;
    void fetchEvents(!isStale);
    let supabase: ReturnType<typeof createBrowserClient>;
    try { supabase = createBrowserClient(); } catch { return; }

    const channel = supabase
      .channel(`community-events:${communityId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "community_events",
        filter: `community_id=eq.${communityId}`,
      }, () => void fetchEvents(true))
      .subscribe();

    const rsvpChannel = supabase
      .channel(`event-rsvps:${communityId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "event_rsvps",
      }, () => void fetchEvents(true))
      .subscribe();

    const saveChannel = supabase
      .channel(`event-saves:${communityId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "event_saves",
      }, (payload) => {
        // Optimistically update save_count without a full refetch
        const row = (payload.new ?? payload.old) as { event_id?: string; user_id?: string } | null;
        if (!row?.event_id) return;
        setEvents((prev) => prev.map((e) => {
          if (e.id !== row.event_id) return e;
          const delta = payload.eventType === "INSERT" ? 1 : payload.eventType === "DELETE" ? -1 : 0;
          const user_saved = row.user_id === currentUserId
            ? payload.eventType === "INSERT"
            : e.user_saved;
          return { ...e, save_count: Math.max(0, e.save_count + delta), user_saved };
        }));
      })
      .subscribe();

    const handleFocus = () => { if (document.visibilityState === "visible") void fetchEvents(true); };
    document.addEventListener("visibilitychange", handleFocus);
    window.addEventListener("focus", handleFocus);

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(rsvpChannel);
      supabase.removeChannel(saveChannel);
      document.removeEventListener("visibilitychange", handleFocus);
      window.removeEventListener("focus", handleFocus);
    };
  }, [communityId, fetchEvents]);

  function writeCache(updater: (prev: CommunityEvent[]) => CommunityEvent[]) {
    setEvents((prev) => {
      const next = updater(prev);
      eventsCache.set(communityId, { data: next, fetchedAt: eventsCache.get(communityId)?.fetchedAt ?? Date.now() });
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

      <div className={`${communityFeedLayout.content} ${!loading && events.length > 0 ? "pt-3" : ""}`}>
        {loading ? (
          <div className={communityFeedLayout.skeletonList}>
            {[1, 2, 3].map((i) => (
              <div key={i} className={communityFeedLayout.skeletonRow}>
                <div className="h-3 w-28 rounded bg-surface-raised" />
                <div className="mt-4 flex flex-col gap-2">
                  <div className="h-4 w-2/3 rounded bg-surface-raised" />
                  <div className="h-3 w-full rounded bg-surface-raised" />
                  <div className="h-3 w-4/5 rounded bg-surface-raised" />
                  <div className="mt-1 flex justify-between">
                    <div className="h-3 w-24 rounded bg-surface-raised" />
                    <div className="h-7 w-16 rounded-lg bg-surface-raised" />
                  </div>
                </div>
              </div>
            ))}
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
          <div className="flex flex-col gap-8">
            {(filter === "all" || filter === "upcoming") && upcoming.length > 0 && (
              <section className="px-5 md:px-8">
                <div className="flex flex-col gap-4">
                  {upcoming.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      currentUserId={currentUserId}
                      communityId={communityId}
                      onUpdated={handleUpdated}
                      onDeleted={handleDeleted}
                      onRsvpChanged={handleRsvpChanged}
                      onSaveChanged={handleSaveChanged}
                    />
                  ))}
                </div>
              </section>
            )}
            {(filter === "all" || filter === "past") && past.length > 0 && (
              <section className="px-5 md:px-8">
                <div className="flex flex-col gap-4 opacity-60">
                  {past.map((event) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      currentUserId={currentUserId}
                      communityId={communityId}
                      onUpdated={handleUpdated}
                      onDeleted={handleDeleted}
                      onRsvpChanged={handleRsvpChanged}
                      onSaveChanged={handleSaveChanged}
                    />
                  ))}
                </div>
              </section>
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
