/**
 * How an event's times read on the card, ported from the web
 * `lib/communities/event-display.ts`.
 *
 * The card always prints the viewer's own clock first; the host's line below
 * it says what the host actually typed, in the zone the event was created in.
 * That second line only appears when the two clocks disagree — repeating the
 * same time twice adds nothing.
 *
 * Pure module (no React Native imports) so the node test suite runs it as-is.
 */
import {
  canonicalZone,
  deviceOffsetMinutes,
  formatOffset,
  wallClockInZone,
  zoneLabel,
  zoneOffsetMinutes,
} from './eventTimezone';

/** "9:00 PM" — the viewer's own clock, in the locale every event surface uses. */
export function formatEventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toUpperCase();
}

/**
 * "9:00 PM – 11:00 PM", or just the start when the event has no end. An
 * unreadable start renders nothing; an unreadable end drops only the range.
 */
export function formatEventTimeRange(startIso: string, endIso?: string | null): string {
  const start = formatEventTime(startIso);
  if (!start) return '';
  const end = endIso ? formatEventTime(endIso) : '';
  return end ? `${start} – ${end}` : start;
}

function formatClock(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** The wall clock a moment reads as at a fixed offset (the stored fallback). */
function wallTimeAtOffset(iso: string, minutesEast: number): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const shifted = new Date(date.getTime() + minutesEast * 60_000);
  return formatClock(shifted.getUTCHours(), shifted.getUTCMinutes());
}

/** The wall clock a moment reads as in a named zone, in 12-hour text. */
function wallTimeInZoneText(iso: string, zone: string): string | null {
  const wall = wallClockInZone(iso, zone);
  const match = wall ? /(\d{2}):(\d{2})$/.exec(wall) : null;
  if (!match) return null;
  return formatClock(Number(match[1]), Number(match[2]));
}

/** The event fields the host-time helpers read. */
export interface HostZonedEvent {
  event_date: string;
  end_date?: string | null;
  host_timezone?: string | null;
  host_utc_offset_minutes?: number | null;
}

export interface HostSchedule {
  /** "3:00 PM – 5:00 PM" — the wall clock the host set, in their own zone. */
  range: string;
  /** "EDT · UTC-4:00" — the zone that clock was stated in. */
  zone: string;
}

/**
 * The host's stated schedule, or null when there is nothing worth adding: the
 * event predates the host zone being recorded, the zone cannot be resolved and
 * no offset was stored, or the host's clock reads the event exactly as this
 * viewer's does.
 */
export function hostScheduleForViewer(event: HostZonedEvent): HostSchedule | null {
  const zone = event.host_timezone?.trim() || null;
  const minutes = typeof event.host_utc_offset_minutes === 'number'
    ? event.host_utc_offset_minutes
    : null;
  if (!zone && minutes === null) return null;

  const start = new Date(event.event_date);
  if (Number.isNaN(start.getTime())) return null;

  const named = zone ? canonicalZone(zone) : null;
  // The zone's own offset wins where it can be read (it carries the DST in
  // force on the event's date); the offset stored at creation is the fallback.
  const zoneMinutes = (named ? zoneOffsetMinutes(named, start) : null) ?? minutes;
  if (zoneMinutes === null) return null;
  if (zoneMinutes === deviceOffsetMinutes(start)) return null;

  const time = (iso: string) =>
    named ? wallTimeInZoneText(iso, named) : wallTimeAtOffset(iso, zoneMinutes);

  const startTime = time(event.event_date);
  if (!startTime) return null;
  const endTime = event.end_date ? time(event.end_date) : '';

  const label = named
    ? zoneLabel(named, start) ?? formatOffset(zoneMinutes)
    : formatOffset(zoneMinutes);

  return {
    range: endTime ? `${startTime} – ${endTime}` : startTime,
    zone: label,
  };
}
