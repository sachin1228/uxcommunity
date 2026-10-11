"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Clock, MapPin, Settings, Users, Video } from "lucide-react";
import { AvatarImg } from "@/components/ui/AvatarImg";
import { openCommunitySettings } from "@/lib/communities/cache";
import { useGuardedRouter } from "@/lib/navigation-guard";
import { fetchJsonCached } from "@/lib/request-cache";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import {
  eventZoneTooltip,
  formatEventTimeRange,
  hostScheduleForViewer,
} from "@/lib/communities/event-display";
import type { CommunityEvent, EventRsvp } from "@/lib/communities/models/events";
import { profileHref } from "@/lib/profile/links";
import { goingPreview, toGoingEntries } from "./going-list";

const REQUEST_STALE_MS = 60_000;
/** Rows in the going list before it becomes a count. */
const VISIBLE_GOING = 6;

interface EventRoomDetails {
  event: CommunityEvent;
  going: EventRsvp[];
  /** Owner-only door, the server's answer: the room is the owner's to keep. */
  carryOn: boolean;
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
    // The event itself changing — an edit, or the delete that takes the room's
    // link away — has to reach this card too: its reader is looking at the
    // room, not at the event page where the change was made. A deleted event
    // answers 404, which is the same "no section" the load already handles.
    const unsubEvent = realtimeClient.on(eventsRoom, "event", () => void load(true));
    const unsubRoom = realtimeClient.subscribe(eventsRoom);
    realtimeClient.connect();

    return () => {
      cancelled = true;
      unsubRsvp();
      unsubEvent();
      unsubRoom();
    };
  }, [communityId, currentUserId, isVisible, url]);

  const loading = !answer || answer.communityId !== communityId;
  return { details: loading ? null : answer.details, loading };
}

/**
 * The card that offers the room to its owner, shared by the two ways a room
 * can have outlived its event.
 *
 * Both states wear the same room: its name is the event's title, its
 * description says "group chat for this event", and its picture is the
 * event's cover — exactly the fields the room's own settings edit, which is
 * why this card is only the door. The info panel is where a member notices
 * the event is over, and nothing else would tell the owner that the room is
 * theirs to keep. Reading as one card in both states keeps the offer the same
 * shape whichever way the event left.
 */
function RoomCarryOnCard({
  communityId,
  headingId,
  heading,
  blurb,
}: {
  communityId: string;
  headingId: string;
  heading: string;
  blurb: string;
}) {
  const router = useGuardedRouter();

  function openSettings() {
    if (openCommunitySettings(communityId)) return;
    // Nothing took the request: the chat view that owns the settings modal is
    // not mounted at this route. Send the owner to the room itself, where the
    // same card's button does open it.
    router.push(`/dashboard/communities/${communityId}`);
  }

  return (
    <section aria-labelledby={headingId} className="border-t border-border px-5 py-5">
      <h2
        id={headingId}
        className="font-display text-[15px] font-semibold text-foreground"
      >
        {heading}
      </h2>
      <p className="mt-3 text-pretty font-body text-sm leading-relaxed text-foreground-muted">
        {blurb}
      </p>
      <button
        type="button"
        onClick={openSettings}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3.5 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Settings strokeWidth={2.5} size={14} aria-hidden="true" />
        Make this room your own
      </button>
    </section>
  );
}

/**
 * What the info card becomes once the room has outlived its event.
 *
 * Deleting an event keeps its group chat (see the event delete route), which
 * leaves a room still wearing all three of the event's things while the link
 * its badge and its Event card read has been cleared. Rendered for the room's
 * owner alone; every other member sees the room exactly as it is (see
 * CommunityRightSidebar, which only draws this when the community is an
 * event's chat with no event behind it).
 */
export function EventRoomGoneSection({ communityId }: { communityId: string }) {
  return (
    <RoomCarryOnCard
      communityId={communityId}
      headingId="sidebar-room-event-heading"
      heading="Event"
      blurb="This room has outlived its event. The people in it and everything they said are still here — give the room a name, a description and a picture of its own and it carries on as a community."
    />
  );
}

/**
 * The offer that meets the room's owner once its event is over for good: the
 * ended badge has come down — twelve hours past the close (see
 * lib/communities/event-date) — and the event itself is still on the calendar.
 * The Event card stays above this one (the event's page, who went): the room
 * outlives its event the moment the event is over, and deleting the event —
 * a host tidying the calendar, possibly months later — must not be the only
 * way to find the room's door.
 *
 * Whether the offer is this room's to take is decided server-side (see
 * loadEventRoomSection): owner, past the grace, still wearing all three of the
 * event's clothes. One personal edit — a name, a description, a picture — and
 * the answer flips to false, so the card retires itself without a dismissal
 * to store — and from then on the event's edits stop following the room (see
 * syncEventChatCommunity).
 */
export function EventRoomCarryOnSection({ communityId }: { communityId: string }) {
  return (
    <RoomCarryOnCard
      communityId={communityId}
      headingId="sidebar-room-carry-on-heading"
      heading="After the event"
      blurb="The event is over — the room and everyone in it are still here. Give the room a name, a description and a picture of its own and it carries on as a community."
    />
  );
}

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
 *
 * The card ends with the door back out of the room: the event's own page, the
 * one the home feed's event card opens (/dashboard/events/[eventId]), where the
 * full description, the discussion and the Join chat row live. The room is the
 * conversation about the event, not the event itself.
 */
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

  const { event, going, carryOn } = details;
  const attended = event.rsvp_count || going.length;
  // The payload is a bounded preview, so the count comes from the event while
  // the names come from the rows we have (see goingPreview).
  const { visible, more } = goingPreview(
    toGoingEntries(going, currentUserId),
    VISIBLE_GOING,
    attended,
  );
  const spotsLeft = event.max_attendees !== null ? event.max_attendees - attended : null;
  // The host's own reading of the schedule — null unless it differs from this
  // viewer's clock, so the row stays silent when there is nothing to compare.
  const hostSchedule = hostScheduleForViewer(event);

  return (
    <>
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

        {event.users && (
          <Link
            href={profileHref(event.user_id)}
            title={event.users.name}
            className="mt-3 inline-flex min-w-0 max-w-full items-center gap-2.5"
          >
            <AvatarImg
              url={event.users.avatar_url}
              name={event.users.name}
              size={24}
              className="h-6 w-6 shrink-0 rounded-full object-cover"
            />
            <span className="min-w-0 truncate font-body text-sm text-foreground-muted hover:underline">
              Hosted by <span className="font-medium text-foreground">{event.users.name}</span>
            </span>
          </Link>
        )}

        {event.cover_image_url && (
          <img
            src={event.cover_image_url}
            alt={event.title}
            className="mt-3 block h-auto w-full rounded-lg"
          />
        )}

        <p className="mt-3 text-pretty font-body text-sm font-medium text-foreground">
          {event.title}
        </p>

        <div className="mt-3 flex flex-col gap-2">
          {/* Date and time in their own rows, like the event card. The times
              are the viewer's own clock; the zone rides on the time's hover
              tooltip. */}
          <Row icon={<CalendarDays strokeWidth={2.5} size={16} />}>
            {fmtEventDate(event.event_date)}
          </Row>
          <Row icon={<Clock strokeWidth={2.5} size={16} />}>
            <span>
              <span className="block" title={eventZoneTooltip(event.event_date)}>
                {formatEventTimeRange(event.event_date, event.end_date)}
              </span>
              {/* What the host set, in their own zone — the same moment, other
                  clock. Shown only when the two readings actually differ. */}
              {hostSchedule && (
                <span
                  className="mt-0.5 block text-xs text-foreground-subtle"
                  title={`The time the host set, in their own zone (${hostSchedule.zone}).`}
                >
                  Host time: {hostSchedule.range} ({hostSchedule.zone})
                </span>
              )}
            </span>
          </Row>
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

        {/* ── Who is going ───────────────────────────────────────────── */}
        <div className="mt-4">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-foreground-subtle">
            Going · {attended}
          </p>
          {visible.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2.5">
              {visible.map((entry) => (
                <li key={entry.user_id} className="flex items-center gap-2.5">
                  <Link
                    href={profileHref(entry.user_id)}
                    title={entry.name}
                    className="flex min-w-0 items-center gap-2.5"
                  >
                    <AvatarImg
                      url={entry.avatar_url}
                      name={entry.name}
                      size={28}
                      className="h-7 w-7 shrink-0 rounded-full object-cover"
                    />
                    <span
                      className={`min-w-0 truncate font-body text-sm hover:underline ${
                        entry.is_self ? "font-medium text-foreground" : "text-foreground-muted"
                      }`}
                    >
                      {entry.label}
                    </span>
                  </Link>
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

        {/* ── The event's own page ───────────────────────────────────── */}
        <Link
          href={`/dashboard/events/${event.id}`}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3.5 py-2 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          View event
          <ArrowRight strokeWidth={2.5} size={14} aria-hidden="true" />
        </Link>
      </section>

      {/* The event is over for good — its badge has come down — and the room's
          door turns up under the card that links back to it. The answer is the
          server's (see loadEventRoomSection), so a room already made its own
          never flashes this. */}
      {carryOn && <EventRoomCarryOnSection communityId={communityId} />}
    </>
  );
}
