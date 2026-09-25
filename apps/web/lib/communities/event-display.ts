import { viewerZoneLabel } from "./event-time";

/**
 * How an event's times read to the member looking at them.
 *
 * What is stored is the instant, and every surface renders it with the
 * browser's own clock — so a host in New York setting 3:00 PM and a member in
 * India are looking at the same moment, spelled the way each of their own
 * clocks spells it. That conversion is correct, and it is also invisible,
 * which is exactly how a member ends up trusting a start time that the host
 * meant in a different zone. These helpers keep the viewer's own zone attached
 * to the number wherever the number is shown.
 */

/** "9:00 PM" — the viewer's own clock, in the locale every event surface uses. */
export function formatEventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .toUpperCase();
}

/**
 * "9:00 PM – 11:00 PM", or just the start when the event has no end. An
 * unreadable start renders nothing: faking the range with a lone end time
 * would read as a start, which is worse than a missing line. An unreadable
 * end simply drops the range — the start still says when to show up.
 */
export function formatEventTimeRange(startIso: string, endIso?: string | null): string {
  const start = formatEventTime(startIso);
  if (!start) return "";
  const end = endIso ? formatEventTime(endIso) : "";
  return end ? `${start} – ${end}` : start;
}

/**
 * The zone an instant lands in for this viewer — "EDT · UTC-4:00", "UTC+5:30".
 * Derived from the event's own date so an event after a DST change names the
 * offset it will actually run at, not today's. Unreadable timestamps fall back
 * to the viewer's current zone rather than losing the label entirely.
 */
export function eventZoneLabel(iso: string): string {
  const date = new Date(iso);
  return viewerZoneLabel(Number.isNaN(date.getTime()) ? new Date() : date);
}

/** The one-line explanation a hovered time gets: whose clock this is. */
export function eventZoneTooltip(iso: string): string {
  return `Shown in your timezone (${eventZoneLabel(iso)}) — the same moment for everyone.`;
}
