"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarX2, Plus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/browser";
import type { CommunityEvent } from "./types";
import { CreateEventModal } from "./CreateEventModal";
import { EventCard } from "./EventCard";

export function EventsView({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/events`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load events.");
      setEvents(data.events as CommunityEvent[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events.");
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => {
    void fetchEvents();
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

  function handleCreated(event: CommunityEvent) {
    setEvents((prev) => [event, ...prev].sort(
      (a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime()
    ));
  }

  function handleUpdated(updated: CommunityEvent) {
    setEvents((prev) =>
      prev
        .map((e) => (e.id === updated.id ? { ...e, ...updated } : e))
        .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
    );
  }

  function handleDeleted(eventId: string) {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
  }

  function handleRsvpChanged(eventId: string, rsvped: boolean, count: number) {
    setEvents((prev) =>
      prev.map((e) => e.id === eventId ? { ...e, user_rsvped: rsvped, rsvp_count: count } : e)
    );
  }

  function handleSaveChanged(eventId: string, saved: boolean, count: number) {
    setEvents((prev) =>
      prev.map((e) => e.id === eventId ? { ...e, user_saved: saved, save_count: count } : e)
    );
  }

  // Split into upcoming and past
  const now = new Date();
  const upcoming = events.filter((e) => new Date(e.end_date ?? e.event_date) >= now);
  const past = events.filter((e) => new Date(e.end_date ?? e.event_date) < now);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">Events</h2>
            <p className="mt-1 font-body text-sm text-foreground-muted">
              Community meetups, workshops, and get-togethers.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-body text-sm font-medium text-accent-foreground hover:bg-accent-hover"
          >
            <Plus size={16} /> Create Event
          </button>
        </div>

        {error && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="font-body text-sm text-red-400">{error}</p>
            <button type="button" onClick={() => void fetchEvents()} className="font-body text-xs text-red-300 underline">Try again</button>
          </div>
        )}

        {loading ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-surface overflow-hidden">
                <div className="h-9 bg-surface-raised border-b border-border" />
                <div className="px-4 py-3 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-surface-raised" />
                  <div className="h-3 w-full rounded bg-surface-raised" />
                  <div className="h-3 w-4/5 rounded bg-surface-raised" />
                  <div className="mt-3 flex justify-between">
                    <div className="h-3 w-24 rounded bg-surface-raised" />
                    <div className="h-7 w-16 rounded-lg bg-surface-raised" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center">
            <CalendarX2 size={28} className="mx-auto text-foreground-subtle" />
            <h3 className="mt-3 font-display text-base font-semibold text-foreground">No events yet</h3>
            <p className="mt-1 font-body text-sm text-foreground-muted">Create the first event for your community.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {upcoming.length > 0 && (
              <section>
                <h3 className="mb-3 font-body text-xs font-semibold uppercase tracking-wider text-foreground-subtle">
                  Upcoming
                </h3>
                <div className="space-y-3">
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
            {past.length > 0 && (
              <section>
                <h3 className="mb-3 font-body text-xs font-semibold uppercase tracking-wider text-foreground-subtle">
                  Past
                </h3>
                <div className="space-y-3 opacity-60">
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
