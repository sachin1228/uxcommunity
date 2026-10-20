/**
 * The clock behind event lifecycle notifications: which of the five moments is
 * due for an event right now, what each one says, and where it opens.
 *
 * Pure on purpose (no database, no network, no Next imports) so the rules —
 * the one-day and half-hour thresholds, the morning-of slot in the host's own
 * zone, the live and ended windows — are unit-tested directly. The fan-out
 * (recipients, the delivery ledger, in-app rows and Expo pushes) lives in
 * ./notifications.ts.
 *
 * The five moments:
 *   tomorrow  at T-24h — only for events created at least a day ahead
 *   today     at 09:00 on the event's own day, while at least 2h remain
 *   soon      at T-30m — the half-hour call
 *   live      in the 15 minutes after the start (while the event still runs)
 *   ended     in the 15 minutes after a recorded end
 *
 * The windows are catch-up allowances, not repeats: the delivery ledger makes
 * each moment land at most once per member, and a run that restarts inside a
 * window still delivers the members it had not reached yet.
 */

import {
  canonicalZoneId,
  formatUtcOffsetMinutes,
  wallTimeAtOffset,
  wallTimeInZone,
  zoneAbbreviation,
  zoneOffsetMinutes,
} from "@/lib/communities/timezone";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long after its exact moment a stage may still be sent. */
export const STAGE_CATCH_UP_MS = 15 * MINUTE_MS;
/** The morning-of notice's hour, in the event's own zone. */
export const DAY_OF_HOUR = 9;
/** The morning-of notice needs this much runway before the start. */
const DAY_OF_MIN_RUNWAY_MS = 2 * HOUR_MS;

export type EventStage = "tomorrow" | "today" | "soon" | "live" | "ended";

export type EventNotificationType = "event_reminder" | "event_live" | "event_ended";

/** The event fields the clock and the copy read — `EVENT_CARD_COLUMNS` subset. */
export interface LifecycleEvent {
  id: string;
  title: string;
  event_date: string;
  end_date: string | null;
  created_at: string;
  host_timezone: string | null;
  host_utc_offset_minutes: number | null;
  community_id: string | null;
}

interface EventZone {
  /** The IANA zone when the runtime knows it, else null. */
  named: string | null;
  /** The offset the host's browser recorded, as a fallback. */
  offsetMinutes: number | null;
}

function zoneOf(event: Pick<LifecycleEvent, "host_timezone" | "host_utc_offset_minutes">): EventZone {
  const raw = event.host_timezone?.trim();
  return {
    named: raw ? canonicalZoneId(raw) : null,
    offsetMinutes:
      typeof event.host_utc_offset_minutes === "number" &&
      Number.isFinite(event.host_utc_offset_minutes)
        ? event.host_utc_offset_minutes
        : null,
  };
}

interface WallDate {
  year: number;
  month: number;
  day: number;
}

/** The calendar date an instant reads as in the event's zone. */
function wallDateIn(instantMs: number, zone: EventZone): WallDate {
  const date = new Date(instantMs);
  if (zone.named) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone.named,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
    const year = Number(part("year"));
    const month = Number(part("month"));
    const day = Number(part("day"));
    if (year && month && day) return { year, month, day };
  }

  // A stored offset is already "the host's clock" — shift it and read as UTC.
  const shifted =
    zone.offsetMinutes !== null ? new Date(instantMs + zone.offsetMinutes * MINUTE_MS) : date;
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * The instant a wall clock names inside the event's zone. Iterates on the
 * offset because the offset itself depends on the guess across a DST change;
 * two passes settle every zone whose 09:00 exists on that date.
 */
function instantAtWallTime(
  date: WallDate,
  minutesOfDay: number,
  zone: EventZone,
): number | null {
  const base = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    Math.floor(minutesOfDay / 60),
    minutesOfDay % 60,
  );
  if (zone.named) {
    let guess = base;
    for (let pass = 0; pass < 2; pass += 1) {
      const offset = zoneOffsetMinutes(zone.named, new Date(guess));
      if (offset === null) return null;
      guess = base - offset * MINUTE_MS;
    }
    return guess;
  }
  if (zone.offsetMinutes !== null) return base - zone.offsetMinutes * MINUTE_MS;
  return base;
}

/** The instant the morning-of notice becomes due for this event. */
function dayOfNoticeAt(event: LifecycleEvent, startMs: number): number | null {
  const zone = zoneOf(event);
  return instantAtWallTime(wallDateIn(startMs, zone), DAY_OF_HOUR * 60, zone);
}

/**
 * Every stage due at `now`. Normally one, occasionally two when a run lands on
 * a boundary; the ledger keeps each one to a single delivery per member.
 *
 * An event with no recorded end runs for the live window only — the app's own
 * badge treats such a window as over when it opens, so a separate "ended"
 * moment would be inventing a duration the host never set.
 */
export function dueStages(event: LifecycleEvent, now: Date): EventStage[] {
  const startMs = Date.parse(event.event_date);
  const createdMs = Date.parse(event.created_at);
  const endMs = event.end_date ? Date.parse(event.end_date) : null;
  const nowMs = now.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(createdMs) || !Number.isFinite(nowMs)) {
    return [];
  }

  const stages: EventStage[] = [];

  const tomorrowAt = startMs - DAY_MS;
  if (
    createdMs <= tomorrowAt &&
    nowMs >= tomorrowAt &&
    nowMs < tomorrowAt + STAGE_CATCH_UP_MS
  ) {
    stages.push("tomorrow");
  }

  const todayAt = dayOfNoticeAt(event, startMs);
  if (
    todayAt !== null &&
    startMs - todayAt >= DAY_OF_MIN_RUNWAY_MS &&
    nowMs >= todayAt &&
    nowMs <= startMs - DAY_OF_MIN_RUNWAY_MS
  ) {
    stages.push("today");
  }

  const soonAt = startMs - 30 * MINUTE_MS;
  if (createdMs <= soonAt && nowMs >= soonAt && nowMs < startMs) {
    stages.push("soon");
  }

  const liveUntil = endMs ?? startMs + STAGE_CATCH_UP_MS;
  if (nowMs >= startMs && nowMs < Math.min(liveUntil, startMs + STAGE_CATCH_UP_MS)) {
    stages.push("live");
  }

  if (
    endMs !== null &&
    nowMs >= endMs &&
    nowMs < endMs + STAGE_CATCH_UP_MS
  ) {
    stages.push("ended");
  }

  // The only overlap the windows allow: a first run landing exactly on the
  // morning slot's closing boundary also sees the half-hour call. The later,
  // more timely moment wins; the morning row would only repeat it.
  return stages.includes("soon") ? stages.filter((stage) => stage !== "today") : stages;
}

/** "8:45 PM IST" — the start clock, said in the event's own zone. */
export function eventStartLabel(event: Pick<LifecycleEvent, "event_date" | "host_timezone" | "host_utc_offset_minutes">): string {
  const startMs = Date.parse(event.event_date);
  if (!Number.isFinite(startMs)) return "";
  const zone = zoneOf(event);

  if (zone.named) {
    const time = wallTimeInZone(event.event_date, zone.named);
    const offset = zoneOffsetMinutes(zone.named, new Date(startMs));
    const label =
      zoneAbbreviation(zone.named, new Date(startMs)) ??
      (offset !== null ? formatUtcOffsetMinutes(offset) : null);
    return [time, label].filter(Boolean).join(" ");
  }

  if (zone.offsetMinutes !== null) {
    return `${wallTimeAtOffset(event.event_date, zone.offsetMinutes)} ${formatUtcOffsetMinutes(zone.offsetMinutes)}`;
  }

  return `${wallTimeInZone(event.event_date, "UTC")} UTC`;
}

export interface LifecycleNotice {
  type: EventNotificationType;
  title: string;
  body: string;
}

/**
 * The notice for one stage — the same words in the in-app list and on the
 * lock screen, so a member who sees both is reading one message, not two.
 *
 * `now` matters only to the half-hour call: a run that lands late (inside the
 * stage's catch-up tail) says "starts soon" rather than claiming thirty
 * minutes that no longer exist.
 */
export function lifecycleNotice(
  event: Pick<LifecycleEvent, "title" | "event_date" | "host_timezone" | "host_utc_offset_minutes">,
  stage: EventStage,
  options: { hasRoom: boolean; now?: Date },
): LifecycleNotice {
  const starts = eventStartLabel(event);
  const at = starts ? `Starts ${starts}.` : "";
  const room = options.hasRoom;

  switch (stage) {
    case "tomorrow":
      return {
        type: "event_reminder",
        title: `Tomorrow: ${event.title}`,
        body: at,
      };
    case "today":
      return {
        type: "event_reminder",
        title: `Today: ${event.title}`,
        body: [at, room ? "The room is open — say hi." : ""].filter(Boolean).join(" "),
      };
    case "soon": {
      const startMs = Date.parse(event.event_date);
      const nowMs = options.now?.getTime() ?? Number.NaN;
      const remainingMinutes = Number.isFinite(nowMs)
        ? Math.round((startMs - nowMs) / 60_000)
        : null;
      const title =
        remainingMinutes !== null && remainingMinutes <= 20
          ? `${event.title} starts soon`
          : `${event.title} starts in 30 minutes`;
      return {
        type: "event_reminder",
        title,
        body: [at, room ? "The room is open." : ""].filter(Boolean).join(" "),
      };
    }
    case "live":
      return {
        type: "event_live",
        title: `${event.title} is live now`,
        body: room ? "The room is open — join now." : "The event has started.",
      };
    case "ended":
      return {
        type: "event_ended",
        title: `${event.title} has ended`,
        body: room
          ? "The room stays open — catch up with everyone."
          : "That's a wrap — see you at the next one.",
      };
  }
}

/** Where the row opens: the event's own detail, community-scoped when it has one. */
export function lifecycleHref(event: Pick<LifecycleEvent, "id" | "community_id">): string {
  return event.community_id
    ? `/dashboard/communities/${event.community_id}/events/${event.id}`
    : `/dashboard/events/${event.id}`;
}
