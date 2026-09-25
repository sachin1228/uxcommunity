/**
 * The date worn by an event group chat's DP in the sidebar: the calendar tile
 * says at a glance which day the room is for, without opening it.
 *
 * Same locale as every other event surface (en-IN) and the same parts as the
 * ticket stub on the event page — month over day, uppercase — so the badge and
 * the event it belongs to read as one thing. On the day itself the tile stops
 * naming the month and says TODAY instead: the room you are about to walk into
 * is the one happening right now, which the bare date cannot say. While the
 * event is actually under way it says LIVE, and for a day after it wraps the
 * tile says ENDED before the room reverts to a plain face — the conversation
 * stays, only the announcement comes down.
 */
const monthFormat = new Intl.DateTimeFormat("en-IN", { month: "short" });
const weekdayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short" });

/** How long the tile keeps saying ENDED after the event's window closes. */
export const EVENT_ENDED_GRACE_MS = 24 * 60 * 60 * 1000;

export interface EventDateBadge {
  /** Month abbreviation, uppercase — "SEPT". */
  month: string;
  /** Day of the month — "25". */
  day: string;
  /** The whole date, for the badge's tooltip and accessible name. */
  label: string;
  /** The event falls on the viewer's own calendar day, so the tile says TODAY. */
  isToday: boolean;
  /** The event's window has opened and not yet closed — the tile says LIVE. */
  isLive: boolean;
  /**
   * The event's window has closed within the last day — the tile says ENDED.
   * Past the day it is false and the caller drops the tile entirely.
   */
  isEnded: boolean;
  /**
   * The event's window has closed (now at or past the end). The caller keeps
   * the tile only while this is false or isEnded is true — everything else is
   * an event still to come, which must keep wearing its date.
   */
  isPast: boolean;
}

export interface EventDateBadgeOptions {
  /** Injectable for tests; production always reads the viewer's clock. */
  now?: Date;
  /**
   * The event's end when the server still has it ahead (`pinned_until`), or
   * its end regardless of when (`event_end`). When neither is known the pin
   * deadline stands in — the event's own start — which is also what makes a
   * window with no recorded end end immediately rather than run all day.
   */
  endsAt?: string | null;
}

function calendarDay(date: Date): number {
  // The same DST-safe comparison sidebar-time.ts uses: 23- and 25-hour days
  // must not make a neighbour date look like today.
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

/**
 * Whether the event's window has closed, for surfaces that should disappear
 * once there is nothing left to be on time for (the event page's join banner).
 * The deadline is the event's end, or its start when it has none — the same
 * stand-in the badge uses, so a window nobody recorded ends when it opens.
 */
export function hasEventEnded(
  startIso: string | null | undefined,
  endsAtIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!startIso) return false;
  const start = new Date(startIso);
  if (!Number.isFinite(start.getTime())) return false;
  const endMs = endsAtIso ? Date.parse(endsAtIso) : start.getTime();
  return Number.isFinite(now.getTime()) && Number.isFinite(endMs) && now.getTime() >= endMs;
}

/**
 * The badge's parts, or null when there is no usable date — an unparseable
 * timestamp must cost the badge rather than render "Invalid Date" on a DP.
 *
 * The label is assembled from its parts rather than formatted in one call:
 * ICU decides where a combined date's commas go (and has changed its mind
 * between versions), while the badge's tooltip should not depend on the
 * runtime it happens to render in.
 */
export function eventDateBadge(
  iso: string | null | undefined,
  { now = new Date(), endsAt }: EventDateBadgeOptions = {},
): EventDateBadge | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;

  const nowMs = now.getTime();
  const endMs = endsAt ? Date.parse(endsAt) : date.getTime();
  const month = monthFormat.format(date);
  return {
    month: month.toUpperCase(),
    day: String(date.getDate()),
    label: `${weekdayFormat.format(date)}, ${date.getDate()} ${month} ${date.getFullYear()}`,
    // Today is the viewer's calendar day, not UTC's: a badge that said TODAY
    // while the viewer's clock still read the day before would be wrong for the
    // only people who can see it.
    isToday:
      Number.isFinite(nowMs) && calendarDay(date) === calendarDay(now),
    // Half-open [start, end): the tile stops saying LIVE the instant the pin
    // expires, so the badge and the sidebar's pin agree on when it is over.
    isLive:
      Number.isFinite(nowMs) &&
      Number.isFinite(endMs) &&
      nowMs >= date.getTime() &&
      nowMs < endMs,
    // The announcement comes down a day after the event: long enough that the
    // room everyone just left still reads as "that was today", short enough
    // that the sidebar does not fill up with tombstones.
    isEnded:
      Number.isFinite(nowMs) &&
      Number.isFinite(endMs) &&
      nowMs >= endMs &&
      nowMs < endMs + EVENT_ENDED_GRACE_MS,
    isPast: Number.isFinite(nowMs) && Number.isFinite(endMs) && nowMs >= endMs,
  };
}
