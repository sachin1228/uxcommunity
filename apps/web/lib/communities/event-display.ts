import {
  formatUtcOffsetMinutes,
  viewerOffsetMinutes,
  viewerZoneLabel,
} from "./event-time";

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

// ─── The host's side of the same moment ─────────────────────────────────────

/**
 * The event fields the host-time helpers read: the instant they scheduled plus,
 * when the row carries them, the zone the host stated it in. Both zone fields
 * are optional — events created before this was recorded simply have no host
 * line, which is the safe fallback rather than a guess.
 */
export interface HostZonedEvent {
  event_date: string;
  end_date?: string | null;
  host_timezone?: string | null;
  host_utc_offset_minutes?: number | null;
}

/** Whether this runtime can format in the named zone at all. */
function zoneIsUsable(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false; // an unknown or legacy name must never throw into a render
  }
}

/** Minutes east of UTC for a named zone at an instant, or null if unusable. */
export function zoneOffsetMinutes(timeZone: string, instant: Date): number | null {
  if (!zoneIsUsable(timeZone)) return null;
  const part = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((entry) => entry.type === "timeZoneName")?.value ?? "";
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part);
  if (!match) return part === "GMT" || part === "UTC" ? 0 : null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** The zone's own abbreviation at an instant ("EDT"), when it has a real one. */
export function zoneAbbreviation(timeZone: string, instant: Date): string | null {
  if (!zoneIsUsable(timeZone)) return null;
  const named = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "short" })
    .formatToParts(instant)
    .find((entry) => entry.type === "timeZoneName")?.value ?? null;
  // A GMT-style name is the offset under another label; not worth repeating.
  return named && !/^(GMT|UTC)/.test(named) ? named : null;
}

/** "EDT · UTC-4:00" for a named zone at an instant, or null if unusable. */
export function zoneLabelInZone(timeZone: string, instant: Date): string | null {
  const minutes = zoneOffsetMinutes(timeZone, instant);
  if (minutes === null) return null;
  const offset = formatUtcOffsetMinutes(minutes);
  const abbrev = zoneAbbreviation(timeZone, instant);
  return abbrev ? `${abbrev} · ${offset}` : offset;
}

/**
 * The wall clock a moment reads as in a named zone — the host's own time, said
 * the way their clock says it.
 */
function wallTimeInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date
    .toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    })
    .toUpperCase();
}

/**
 * A moment shifted by a stored offset and read as UTC — the host's wall clock
 * reconstructed without needing their zone name. This is the fallback that
 * keeps the host's time visible when a browser cannot resolve the stored zone.
 */
function wallTimeAtOffset(iso: string, minutesEast: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() + minutesEast * 60_000);
  return shifted
    .toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
    })
    .toUpperCase();
}

export interface HostSchedule {
  /** "3:00 PM – 5:00 PM" — the wall clock the host set, in their own zone. */
  range: string;
  /** "EDT · UTC-4:00" — the zone that clock was stated in. */
  zone: string;
}

/**
 * The host's stated schedule, for the surfaces that show it beside the
 * viewer's own reading — or null when there is nothing worth adding.
 *
 * Null in three cases, all deliberate: the event predates the host zone being
 * recorded; the stored zone name cannot be resolved and no offset was stored
 * either; and the host's clock reads the event exactly as this viewer's does,
 * where a second line would only repeat the first. The stored offset is the
 * fallback whenever the zone name means nothing to this runtime.
 */
export function hostScheduleForViewer(event: HostZonedEvent): HostSchedule | null {
  const zone = event.host_timezone?.trim() || null;
  const minutes = typeof event.host_utc_offset_minutes === "number"
    ? event.host_utc_offset_minutes
    : null;
  if (!zone && minutes === null) return null;

  const start = new Date(event.event_date);
  if (Number.isNaN(start.getTime())) return null;

  const named = zone && zoneIsUsable(zone) ? zone : null;
  // The zone's own offset wins where it can be read (it carries the DST in
  // force on the event's date); the offset the host's browser stored at the
  // time is the fallback, which is the whole reason it is stored.
  const zoneMinutes = (named ? zoneOffsetMinutes(named, start) : null) ?? minutes;
  if (zoneMinutes === null) return null;
  // Same clock as the reader's own: the line above already says it.
  if (zoneMinutes === viewerOffsetMinutes(start)) return null;

  const time = (iso: string) =>
    named ? wallTimeInZone(iso, named) : wallTimeAtOffset(iso, zoneMinutes);

  const startTime = time(event.event_date);
  if (!startTime) return null;
  const endTime = event.end_date ? time(event.end_date) : "";

  const zoneLabel = named
    ? zoneLabelInZone(named, start) ?? formatUtcOffsetMinutes(zoneMinutes)
    : formatUtcOffsetMinutes(zoneMinutes);

  return {
    range: endTime ? `${startTime} – ${endTime}` : startTime,
    zone: zoneLabel,
  };
}
