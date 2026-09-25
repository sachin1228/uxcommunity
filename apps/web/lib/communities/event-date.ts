/**
 * The date worn by an event group chat's DP in the sidebar: the calendar tile
 * says at a glance which day the room is for, without opening it.
 *
 * Same locale as every other event surface (en-IN) and the same parts as the
 * ticket stub on the event page — month over day, uppercase — so the badge and
 * the event it belongs to read as one thing. On the day itself the tile stops
 * naming the month and says TODAY instead: the room you are about to walk into
 * is the one happening right now, which the bare date cannot say. While the
 * event is actually under way it goes one step further and says LIVE, which is
 * the difference between "this is today's room" and "this room is on now".
 */
const monthFormat = new Intl.DateTimeFormat("en-IN", { month: "short" });
const weekdayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "short" });

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
}

export interface EventDateBadgeOptions {
  /** Injectable for tests; production always reads the viewer's clock. */
  now?: Date;
  /**
   * The event's end. The sidebar's `pinned_until` is exactly this — the server
   * sends it only while it is still ahead (see loadEventChatSidebarMeta), which
   * is also the window in which the event can be happening.
   *
   * A window with no end is never live: an event whose finish nobody recorded
   * must not be announced as on now for the rest of the day. The date badge
   * still names the day, which is what the room's DP is for.
   */
  endsAt?: string | null;
}

function calendarDay(date: Date): number {
  // The same DST-safe comparison sidebar-time.ts uses: 23- and 25-hour days
  // must not make a neighbour date look like today.
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
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
  const endMs = endsAt ? Date.parse(endsAt) : Number.NaN;
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
  };
}
