"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, MapPin, Users, Video } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { fetchJsonCached } from "@/lib/request-cache";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import type { CommunityEvent, EventRsvp } from "./types";
import { goingPreview, toGoingEntries } from "./going-list";

/**
 * The "Event" section of the community info card, for an event's group chat.
 *
 * A room's members are not the same list as the people going to its event: the
 * room is where they talk, the RSVPs are who is coming. This section answers the
 * two questions the chat itself can't — what the event is (when, where, how
 * full) and who is going — without making the reader leave the room (see
 * /api/communities/[id]/event, which resolves that answer server-side).
 *
 * Rendered by CommunityRightSidebar, between Members and About, and only for
 * communities of type `event`: every other community answers null here and
 * draws nothing.
 */

const REQUEST_STALE_MS = 60_000;
/** Rows in the going list before it becomes a count. */
const VISIBLE_GOING = 6;

interface EventRoomDetails {
  event: CommunityEvent;
  going: EventRsvp[];
}

// Same locale as the event card and its dialogs (en-IN) — the sidebar sits on
// the same page as the card, so the two must not disagree about the date.
function fmtEventDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(iso: string) {
  return new Date(iso)
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .toUpperCase();
}

function fmtSchedule(event: CommunityEvent) {
  const start = `${fmtEventDate(event.event_date)} · ${fmtTime(event.event_date)}`;
  return event.end_date ? `${start} – ${fmtTime(event.end_date)}` : start;
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 font-body text-sm text-foreground-muted">
      <span className="mt-0.5 shrink-0 text-foreground-subtle" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 text-pretty">{children}</span>
    </div>
  );
}

function useEventRoomDetails(communityId: string, currentUserId: string) {
  // The answer carries the community it belongs to, so a room switch can never
  // render the previous room's event and the effect needs no reset-on-mount
  // state write (see `loading`).
  const [answer, setAnswer] = useState<{
    communityId: string;
    details: EventRoomDetails | null;
  } | null>(null);
  const isVisible = useDocumentVisible();
  const url = `/api/communities/${communityId}/event`;

  useEffect(() => {
    let cancelled = false;

    const load = async (force = false) => {
      try {
        const data = await fetchJsonCached<EventRoomDetails>(
          url,
          { staleMs: REQUEST_STALE_MS, force },
          currentUserId,
        );
        if (!cancelled) setAnswer({ communityId, details: data });
      } catch {
        // Not an event's room (or the event is gone): no section at all.
        if (!cancelled) setAnswer({ communityId, details: null });
      }
    };
    void load();

    // Somebody else's RSVP should appear in the list while the room is open —
    // the events room already carries the topic, so this costs one subscription
    // on a page that is otherwise silent about who is coming.
    if (!isVisible || !currentUserId) {
      return () => {
        cancelled = true;
      };
    }

    const eventsRoom = realtimeRooms.events(communityId);
    const unsubRsvp = realtimeClient.on(eventsRoom, "rsvp", () => void load(true));
    const unsubRoom = realtimeClient.subscribe(eventsRoom);
    realtimeClient.connect();

    return () => {
      cancelled = true;
      unsubRsvp();
      unsubRoom();
    };
  }, [communityId, currentUserId, isVisible, url]);

  const loading = !answer || answer.communityId !== communityId;
  return { details: loading ? null : answer.details, loading };
}

export function EventRoomSection({
  communityId,
  currentUserId,
}: {
  communityId: string;
  currentUserId: string;
}) {
  const { details, loading } = useEventRoomDetails(communityId, currentUserId);

  if (!details) {
    // Nothing to draw: either the answer is still on its way (skeleton, like
    // the neighbouring sections) or this community has no event behind it.
    if (!loading) return null;
    return (
      <section aria-labelledby="sidebar-event-heading" className="border-t border-border px-5 py-5">
        <h2
          id="sidebar-event-heading"
          className="font-display text-[15px] font-semibold text-foreground"
        >
          Event
        </h2>
        <div className="mt-3 flex flex-col gap-2" aria-hidden="true">
          <span className="h-3.5 w-2/3 rounded bg-surface-raised animate-pulse" />
          <span className="h-3.5 w-full rounded bg-surface-raised animate-pulse" />
          <span className="h-3.5 w-1/2 rounded bg-surface-raised animate-pulse" />
        </div>
      </section>
    );
  }

  const { event, going } = details;
  const attended = event.rsvp_count || going.length;
  // The payload is a bounded preview, so the count comes from the event while
  // the names come from the rows we have (see goingPreview).
  const { visible, more } = goingPreview(
    toGoingEntries(going, currentUserId),
    VISIBLE_GOING,
    attended,
  );
  const spotsLeft = event.max_attendees !== null ? event.max_attendees - attended : null;

  return (
    <section
      aria-labelledby="sidebar-event-heading"
      className="border-t border-border px-5 py-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="sidebar-event-heading"
          className="font-display text-[15px] font-semibold text-foreground"
        >
          Event
        </h2>
        {event.user_rsvped && (
          <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 font-body text-xs font-medium text-accent">
            Going
          </span>
        )}
      </div>

      <p className="mt-3 text-pretty font-body text-sm font-medium text-foreground">
        {event.title}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {/* One row carries the whole schedule — the card does the same, so a
            multi-day event reads the same in both places. */}
        <Row icon={<CalendarDays strokeWidth={2.5} size={16} />}>{fmtSchedule(event)}</Row>
        <Row icon={event.is_online ? <Video strokeWidth={2.5} size={16} /> : <MapPin strokeWidth={2.5} size={16} />}>
          {event.is_online ? "Online event" : event.location ?? "Location shared by the host"}
        </Row>
        <Row icon={<Users strokeWidth={2.5} size={16} />}>
          {spotsLeft === null
            ? `${attended} going`
            : spotsLeft > 0
              ? `${spotsLeft} of ${event.max_attendees} spots remaining`
              : "No spots remaining"}
        </Row>
      </div>

      {/* ── Who is going ─────────────────────────────────────────────── */}
      <div className="mt-4 border-t border-border pt-4">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-foreground-subtle">
          Going · {attended}
        </p>
        {visible.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2.5">
            {visible.map((entry) => (
              <li key={entry.user_id} className="flex items-center gap-2.5">
                <AvatarImg
                  url={entry.avatar_url}
                  name={entry.name}
                  size={28}
                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                />
                <span
                  className={`min-w-0 truncate font-body text-sm ${
                    entry.is_self ? "font-medium text-foreground" : "text-foreground-muted"
                  }`}
                >
                  {entry.label}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 font-body text-sm text-foreground-muted">
            No one is going yet.
          </p>
        )}
        {more > 0 && (
          <p className="mt-2 font-body text-xs text-foreground-subtle">
            +{more} more going
          </p>
        )}
      </div>
    </section>
  );
}
