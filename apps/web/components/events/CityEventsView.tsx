"use client";

import { useRef, useState } from "react";
import { CalendarCheck2, CalendarClock, CalendarX2, MapPinned } from "lucide-react";
import type { CityEventItem } from "@/lib/events/service";
import { EventCard } from "@/components/communities/events/EventCard";
import { communityFeedLayout } from "@/components/communities/feed-layout";
import { filterChip } from "@/components/communities/filter-chip";
import { GradientButton } from "@/components/ui/GradientButton";
import { Spinner } from "@/components/ui/Spinner";
import { publishContentChange } from "@/lib/communities/content-sync";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { useNowTick } from "@/lib/use-now-tick";
import { filterQuery, type EventDateFilter, type EventTypeFilter } from "./event-filters";
import { EventFiltersMenu } from "./EventFiltersMenu";

/**
 * How often the Upcoming/Past split re-reads the clock. An event finishing
 * while the tab is open has to cross that line on its own — same tick as the
 * community events tab.
 */
const EVENTS_SPLIT_TICK_MS = 30_000;

function mergeUniqueEvents(events: CityEventItem[]) {
  const byId = new Map<string, CityEventItem>();
  for (const event of events) byId.set(event.id, event);
  return [...byId.values()];
}

/**
 * The standalone Events page's list — the community events tab's chips, split
 * and cards without the community shell. There is no create button (events
 * belong to a community and are created from it) and no community realtime
 * room; "Load more" pages one phase at a time through /api/events/city.
 */
export function CityEventsView({
  currentUserId,
  cityName,
  initialUpcoming,
  initialPast,
  initialUpcomingCursor,
  initialPastCursor,
  loadFailed = false,
}: {
  currentUserId: string;
  cityName: string | null;
  initialUpcoming: CityEventItem[];
  initialPast: CityEventItem[];
  initialUpcomingCursor: string | null;
  initialPastCursor: string | null;
  loadFailed?: boolean;
}) {
  const router = useGuardedRouter();
  const [events, setEvents] = useState<CityEventItem[]>(() =>
    mergeUniqueEvents([...initialUpcoming, ...initialPast]),
  );
  // One cursor per phase. "past" from an exhausted upcoming page means "this
  // phase is done" here — the past tab pages its own cursor instead.
  const [cursors, setCursors] = useState(() => ({
    upcoming: initialUpcomingCursor === "past" ? null : initialUpcomingCursor,
    past: initialPastCursor === "past" ? null : initialPastCursor,
  }));
  const [filter, setFilter] = useState<"upcoming" | "past">("upcoming");
  const [typeFilter, setTypeFilter] = useState<EventTypeFilter>("all");
  const [dateFilter, setDateFilter] = useState<EventDateFilter>("any");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(loadFailed ? "Couldn't load events." : null);
  // Filter changes refetch both phases; a stale response must not overwrite a
  // newer one when the chips are clicked in quick succession.
  const requestSeq = useRef(0);

  function updateEvents(updater: (prev: CityEventItem[]) => CityEventItem[]) {
    setEvents((prev) => mergeUniqueEvents(updater(prev)));
  }

  /**
   * A filter change is a fresh stream: both phases are refetched from their
   * first page with the new filters, and the old cursors are replaced — paging
   * never mixes filter sets.
   */
  async function applyFilters(nextType: EventTypeFilter, nextDate: EventDateFilter) {
    if (nextType === typeFilter && nextDate === dateFilter) return;
    setTypeFilter(nextType);
    setDateFilter(nextDate);
    setLoading(true);
    const seq = ++requestSeq.current;
    try {
      const params = filterQuery(nextType, nextDate, new Date());
      const [upcomingRes, pastRes] = await Promise.all([
        fetch(`/api/events/city?${params}`),
        fetch(`/api/events/city?${params}&cursor=past`),
      ]);
      if (!upcomingRes.ok || !pastRes.ok) throw new Error();
      const [upcomingData, pastData] = (await Promise.all([
        upcomingRes.json(),
        pastRes.json(),
      ])) as Array<{ events?: CityEventItem[]; nextCursor?: string | null }>;
      if (seq !== requestSeq.current) return;
      setEvents(mergeUniqueEvents([...(upcomingData.events ?? []), ...(pastData.events ?? [])]));
      setCursors({
        upcoming: upcomingData.nextCursor === "past" ? null : upcomingData.nextCursor ?? null,
        past: pastData.nextCursor === "past" ? null : pastData.nextCursor ?? null,
      });
      setError(null);
    } catch {
      if (seq === requestSeq.current) setError("Failed to load events.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  async function loadMore() {
    const cursor = cursors[filter];
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const seq = requestSeq.current;
    try {
      const params = filterQuery(typeFilter, dateFilter, new Date());
      params.set("cursor", cursor);
      const response = await fetch(`/api/events/city?${params}`);
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { events?: CityEventItem[]; nextCursor?: string | null };
      // A filter change while this was in flight already replaced the stream.
      if (seq !== requestSeq.current) return;
      updateEvents((prev) => [...prev, ...(data.events ?? [])]);
      setCursors((current) => ({
        ...current,
        [filter]: data.nextCursor === "past" ? null : data.nextCursor ?? null,
      }));
    } catch {
      setError("Failed to load more events.");
    } finally {
      setLoadingMore(false);
    }
  }

  function handleUpdated(updated: CityEventItem) {
    updateEvents((prev) => prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e)));
    publishContentChange({
      kind: "event",
      id: updated.id,
      patch: updated as unknown as Record<string, unknown>,
    });
  }

  function handleDeleted(eventId: string) {
    updateEvents((prev) => prev.filter((e) => e.id !== eventId));
    publishContentChange({ kind: "event", id: eventId, removed: true });
  }

  function handleRsvpChanged(eventId: string, rsvped: boolean, count: number) {
    updateEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, user_rsvped: rsvped, rsvp_count: count } : e)));
    publishContentChange({ kind: "event", id: eventId, patch: { user_rsvped: rsvped, rsvp_count: count } });
  }

  function handleLikeChanged(eventId: string, liked: boolean, count: number) {
    updateEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, user_liked: liked, like_count: count } : e)));
    publishContentChange({ kind: "event", id: eventId, patch: { user_liked: liked, like_count: count } });
  }

  function handleSaveChanged(eventId: string, saved: boolean, count: number) {
    updateEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, user_saved: saved, save_count: count } : e)));
    publishContentChange({ kind: "event", id: eventId, patch: { user_saved: saved, save_count: count } });
  }

  // Split against a clock that keeps moving — the boundary is a moment, so
  // both lists (and the cards, which decide their own ended state from this
  // same `now`) turn over on their own.
  const nowMs = useNowTick(EVENTS_SPLIT_TICK_MS);
  const now = new Date(nowMs);
  const upcoming = events
    .filter((e) => new Date(e.end_date ?? e.event_date) >= now)
    .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
  const past = events
    .filter((e) => new Date(e.end_date ?? e.event_date) < now)
    .sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime());

  const filtersActive = typeFilter !== "all" || dateFilter !== "any";
  // The chips stay while a filter is on even if it matches nothing — otherwise
  // an empty result would take away the only way to clear it.
  const showFilters = cityName !== null && !error && (events.length > 0 || filtersActive || loading);
  const activeList = filter === "upcoming" ? upcoming : past;

  return (
    <>
      <div
        className={`${communityFeedLayout.content} px-4 ${
          showFilters ? communityFeedLayout.pageHeaderWithFilters : communityFeedLayout.pageHeader
        }`}
      >
        <div className={communityFeedLayout.pageHeaderMain}>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-foreground">Events</h1>
            <p className="mt-1 max-w-sm text-pretty font-body text-sm leading-5 text-foreground-muted">
              {cityName
                ? `Public events happening in ${cityName}.`
                : "Public events happening in your city."}
            </p>
          </div>
        </div>

        {showFilters && (
          <div className={`${communityFeedLayout.pageHeaderFilters} flex items-start justify-between gap-2 pb-1`}>
            <div className="flex flex-wrap items-center gap-2">
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
            {/* Type and date live behind one trigger so the row stays
                chips + button; the trigger tints while a filter is set. */}
            <EventFiltersMenu
              type={typeFilter}
              date={dateFilter}
              active={filtersActive}
              onSelect={(nextType, nextDate) => void applyFilters(nextType, nextDate)}
            />
          </div>
        )}

        {error && (
          <div className="mt-5 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="font-body text-sm text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="font-body text-xs text-red-300 underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      <div className={`${communityFeedLayout.content} px-4`}>
        {loading ? (
          <div className="flex items-center justify-center py-24" aria-label="Loading events" role="status">
            <Spinner size={28} />
          </div>
        ) : !cityName ? (
          <div className={communityFeedLayout.emptyState}>
            <MapPinned strokeWidth={2.5} size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No city on your profile yet</h3>
            <p className={communityFeedLayout.emptyDescription}>
              Add your city and this page will show you the public events happening there.
            </p>
            <div className="mt-5">
              <GradientButton onClick={() => router.push("/dashboard/profile")}>
                Open your profile
              </GradientButton>
            </div>
          </div>
        ) : error && events.length === 0 ? null : events.length === 0 && filtersActive ? (
          <div className={communityFeedLayout.emptyState}>
            <CalendarX2 strokeWidth={2.5} size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No matching events</h3>
            <p className={communityFeedLayout.emptyDescription}>
              Nothing matches these filters — widen the date or the type.
            </p>
          </div>
        ) : events.length === 0 ? (
          <div className={communityFeedLayout.emptyState}>
            <CalendarX2 strokeWidth={2.5} size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No public events in {cityName} yet</h3>
            <p className={communityFeedLayout.emptyDescription}>
              Events shared publicly for your city will show up here.
            </p>
          </div>
        ) : activeList.length === 0 ? (
          <div className={communityFeedLayout.emptyState}>
            <CalendarX2 strokeWidth={2.5} size={24} className={communityFeedLayout.emptyIcon} />
            <h3 className={communityFeedLayout.emptyTitle}>No {filter} events</h3>
            <p className={communityFeedLayout.emptyDescription}>
              {filtersActive
                ? "Nothing matches these filters here — try the other tab or widen them."
                : filter === "upcoming"
                  ? "Nothing is scheduled right now — the Past tab has what already happened."
                  : "Nothing in your city has wrapped up yet."}
            </p>
          </div>
        ) : (
          <div className={communityFeedLayout.cardList}>
            {activeList.map((event) => {
              const isPast = new Date(event.end_date ?? event.event_date) < now;
              return (
                <div key={event.id} className={isPast ? "opacity-60" : ""}>
                  <EventCard
                    event={event}
                    currentUserId={currentUserId}
                    communityId={event.community_id}
                    communityName={event.community_name ?? undefined}
                    communityImage={event.community_image ?? null}
                    onUpdated={handleUpdated}
                    onDeleted={handleDeleted}
                    onRsvpChanged={handleRsvpChanged}
                    onLikeChanged={handleLikeChanged}
                    onSaveChanged={handleSaveChanged}
                    onOpen={() => router.push(`/dashboard/events/${event.id}`)}
                  />
                </div>
              );
            })}
            {cursors[filter] && (
              <div className="flex justify-center py-6">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="rounded-lg border border-border px-4 py-2 font-body text-sm text-foreground hover:bg-surface-raised disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
