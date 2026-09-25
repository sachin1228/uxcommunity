/**
 * Which clock an event's typed times are on, for the mobile composer.
 *
 * The phone types a wall clock — "2026-08-15 18:30" — and nothing else, so the
 * zone is the only thing standing between that text and the instant it names.
 * The device's own zone is the default; a host scheduling for somewhere they
 * aren't, or carrying a phone set to the wrong zone, can say otherwise.
 *
 * This mirrors apps/web/lib/communities/timezone.ts, trimmed to what a composer
 * needs. The one deliberate difference is the table: the web picker lists a
 * hundred rows because a desktop form can scroll through them, while this one
 * keeps a shorter list that still reaches every offset in use — including the
 * fractional ones (5:30, 5:45, 4:30, 3:30, 6:30, 8:45, 9:30, 10:30, 12:45,
 * 13:45, -2:30, -3:30, -9:30) that an hour-only list loses. The suite proves
 * that coverage holds.
 *
 * Everything here degrades to null where the runtime lacks zone support, so the
 * composer can hide the picker rather than read a typed clock in a zone it
 * cannot honour — the failure that would put an event hours from what the host
 * meant.
 */

export interface TimeZoneChoice {
  zone: string;
  label: string;
}

/**
 * The zones the picker offers, with the name a member should read rather than
 * the id. Ids are canonicalised on the way out, so a phone reporting an alias
 * ("Asia/Calcutta") lands on the same row as the modern spelling.
 */
const ZONE_TABLE: Array<[zone: string, city: string]> = [
  ['UTC', 'UTC'],
  ['Pacific/Midway', 'Midway'],
  ['Pacific/Honolulu', 'Honolulu'],
  ['Pacific/Marquesas', 'Marquesas Islands'],
  ['America/Anchorage', 'Anchorage'],
  ['America/Los_Angeles', 'Los Angeles'],
  ['America/Vancouver', 'Vancouver'],
  ['America/Phoenix', 'Phoenix'],
  ['America/Denver', 'Denver'],
  ['America/Mexico_City', 'Mexico City'],
  ['America/Chicago', 'Chicago'],
  ['America/Bogota', 'Bogotá'],
  ['America/Lima', 'Lima'],
  ['America/New_York', 'New York'],
  ['America/Toronto', 'Toronto'],
  ['America/Halifax', 'Halifax'],
  ['America/Santiago', 'Santiago'],
  ['America/St_Johns', "St. John's"],
  ['America/Sao_Paulo', 'São Paulo'],
  ['America/Argentina/Buenos_Aires', 'Buenos Aires'],
  ['America/Noronha', 'Fernando de Noronha'],
  ['Atlantic/Azores', 'Azores'],
  ['Atlantic/Cape_Verde', 'Cape Verde'],
  ['Europe/London', 'London'],
  ['Europe/Dublin', 'Dublin'],
  ['Europe/Lisbon', 'Lisbon'],
  ['Europe/Madrid', 'Madrid'],
  ['Europe/Paris', 'Paris'],
  ['Europe/Amsterdam', 'Amsterdam'],
  ['Europe/Berlin', 'Berlin'],
  ['Europe/Zurich', 'Zurich'],
  ['Europe/Rome', 'Rome'],
  ['Europe/Warsaw', 'Warsaw'],
  ['Europe/Stockholm', 'Stockholm'],
  ['Europe/Athens', 'Athens'],
  ['Europe/Istanbul', 'Istanbul'],
  ['Europe/Kyiv', 'Kyiv'],
  ['Europe/Moscow', 'Moscow'],
  ['Africa/Casablanca', 'Casablanca'],
  ['Africa/Lagos', 'Lagos'],
  ['Africa/Cairo', 'Cairo'],
  ['Africa/Nairobi', 'Nairobi'],
  ['Africa/Johannesburg', 'Johannesburg'],
  ['Asia/Jerusalem', 'Jerusalem'],
  ['Asia/Riyadh', 'Riyadh'],
  ['Asia/Baghdad', 'Baghdad'],
  ['Asia/Tehran', 'Tehran'],
  ['Asia/Dubai', 'Dubai'],
  ['Asia/Karachi', 'Karachi'],
  ['Asia/Kabul', 'Kabul'],
  ['Asia/Kolkata', 'Kolkata'],
  ['Asia/Colombo', 'Colombo'],
  ['Asia/Kathmandu', 'Kathmandu'],
  ['Asia/Dhaka', 'Dhaka'],
  ['Asia/Yangon', 'Yangon'],
  ['Asia/Bangkok', 'Bangkok'],
  ['Asia/Jakarta', 'Jakarta'],
  ['Asia/Ho_Chi_Minh', 'Ho Chi Minh City'],
  ['Asia/Singapore', 'Singapore'],
  ['Asia/Manila', 'Manila'],
  ['Asia/Shanghai', 'Shanghai'],
  ['Asia/Hong_Kong', 'Hong Kong'],
  ['Asia/Taipei', 'Taipei'],
  ['Asia/Seoul', 'Seoul'],
  ['Asia/Tokyo', 'Tokyo'],
  ['Australia/Perth', 'Perth'],
  ['Australia/Eucla', 'Eucla'],
  ['Australia/Adelaide', 'Adelaide'],
  ['Australia/Darwin', 'Darwin'],
  ['Australia/Brisbane', 'Brisbane'],
  ['Australia/Lord_Howe', 'Lord Howe Island'],
  ['Australia/Sydney', 'Sydney'],
  ['Australia/Melbourne', 'Melbourne'],
  ['Pacific/Guam', 'Guam'],
  ['Pacific/Auckland', 'Auckland'],
  ['Pacific/Fiji', 'Fiji'],
  ['Pacific/Chatham', 'Chatham Islands'],
  ['Pacific/Tongatapu', "Nuku'alofa"],
  ['Pacific/Kiritimati', 'Kiritimati'],
];

/** Every zone the picker's table names, for the suite to hold it to. */
export const CURATED_ZONES: readonly string[] = ZONE_TABLE.map(([zone]) => zone);

/** The zone the phone itself is on, or null where the runtime cannot say. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

let zoneSupport: boolean | null = null;

/**
 * Whether this runtime can actually read a named zone — Hermes ships `Intl`
 * with differing levels of zone support, and a build that ignores the
 * `timeZone` option silently reports the *device's* offset instead. Asking for
 * a zone whose offset is known at a known instant is what tells the two apart:
 * an answer that doesn't match means the option was ignored.
 */
export function timeZoneIsSupported(): boolean {
  if (zoneSupport !== null) return zoneSupport;
  try {
    const part = new Intl.DateTimeFormat('en', {
      timeZone: 'America/New_York',
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date('2026-01-15T12:00:00Z'))
      .find((entry) => entry.type === 'timeZoneName')?.value;
    zoneSupport = part === 'GMT-05:00';
  } catch {
    zoneSupport = false;
  }
  return zoneSupport;
}

/** The spelling this runtime uses for a zone, so aliases share one row. */
export function canonicalZone(zone: string): string | null {
  if (!zone || !timeZoneIsSupported()) return null;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** Minutes east of UTC for a named zone at an instant, or null if unusable. */
export function zoneOffsetMinutes(zone: string, instant: Date): number | null {
  if (!timeZoneIsSupported()) return null;
  try {
    const part = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(instant)
      .find((entry) => entry.type === 'timeZoneName')?.value ?? '';
    // "GMT+05:30" / "GMT-04:00"; a zone exactly on UTC renders as "GMT".
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part);
    if (!match) return /^(GMT|UTC)$/.test(part) ? 0 : null;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3]));
  } catch {
    return null;
  }
}

/** Minutes east of UTC written as a label — "UTC+5:30", "UTC-4:00", "UTC". */
export function formatOffset(minutesEast: number): string {
  if (minutesEast === 0) return 'UTC';
  const abs = Math.abs(minutesEast);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `UTC${minutesEast < 0 ? '-' : '+'}${Math.floor(abs / 60)}:${pad(abs % 60)}`;
}

/** "EDT · UTC-4:00" for a named zone at an instant, or null if unusable. */
export function zoneLabel(zone: string, instant: Date): string | null {
  const minutes = zoneOffsetMinutes(zone, instant);
  if (minutes === null) return null;
  const offset = formatOffset(minutes);
  let abbrev: string | null = null;
  try {
    const named = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(instant)
      .find((entry) => entry.type === 'timeZoneName')?.value ?? null;
    // A GMT-style name is the offset under another label; not worth repeating.
    abbrev = named && !/^(GMT|UTC)/.test(named) ? named : null;
  } catch {
    abbrev = null;
  }
  return abbrev ? `${abbrev} · ${offset}` : offset;
}

/** A city name from an id, for zones that aren't in the table above. */
function cityFromZoneId(id: string): string {
  const [, ...rest] = id.split('/');
  if (rest.length === 0) return id;
  const [region, city] = rest.length > 1 ? [rest[0], rest[rest.length - 1]] : [null, rest[0]];
  const named = city.replace(/_/g, ' ');
  return region && /^[A-Z][a-z]+$/.test(region) ? `${named}, ${region.replace(/_/g, ' ')}` : named;
}

/**
 * The picker's rows, labelled for one instant so the offsets shown are the ones
 * that will actually apply. `extra` zones (the device's own, and the zone an
 * event was created in) are folded in when the table doesn't already cover
 * them, so neither can be missing from the list.
 */
export function timeZoneChoices(
  instant: Date,
  extra: Array<string | null | undefined> = [],
): TimeZoneChoice[] {
  const cities = new Map<string, string>();
  for (const [zone, city] of ZONE_TABLE) {
    const canonical = canonicalZone(zone);
    if (canonical) cities.set(canonical, city);
  }

  const seen = new Set<string>();
  const rows: Array<{ zone: string; label: string; minutes: number }> = [];
  const add = (zone: string | null | undefined) => {
    if (!zone) return;
    const canonical = canonicalZone(zone) ?? zone;
    if (seen.has(canonical)) return;
    const minutes = zoneOffsetMinutes(canonical, instant);
    if (minutes === null) return;
    seen.add(canonical);
    const offset = zoneLabel(canonical, instant) ?? formatOffset(minutes);
    const name = cities.get(canonical) ?? cityFromZoneId(canonical);
    // "UTC" is its own offset; every other zone pairs a place with one.
    rows.push({ zone: canonical, label: name === offset ? name : `${name} · ${offset}`, minutes });
  };

  for (const [zone] of ZONE_TABLE) add(zone);
  for (const zone of extra) add(zone);
  // Sorted by offset so neighbouring zones sit together — searching by place
  // and scanning by offset both work on the same list.
  return rows
    .sort((a, b) => a.minutes - b.minutes || a.label.localeCompare(b.label))
    .map(({ zone, label }) => ({ zone, label }));
}

/**
 * The wall clock a moment reads as in a named zone, as a date field's text —
 * "2026-08-15 18:30". The composer needs it to open an event created in another
 * zone on the clock its times were typed on, which is what lets an untouched
 * save hand back the same instant.
 */
export function wallClockInZone(instant: string | Date, zone: string): string | null {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime()) || !timeZoneIsSupported()) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }).formatToParts(date);
    const pick = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
    const [y, mo, d, hh, mm] = ['year', 'month', 'day', 'hour', 'minute'].map(pick);
    if (!y || !mo || !d || !hh || !mm) return null;
    return `${y}-${mo}-${d} ${hh}:${mm}`;
  } catch {
    return null;
  }
}

/**
 * The instant a typed wall clock names inside a named zone. An offset only
 * means something at a moment, so the zone's offset is read at the wall time
 * and then re-read at the instant it implies; a clock time on the far side of
 * a DST change needs that second pass to land on the right side of it. Null
 * when the text isn't a wall clock or the zone can't be resolved — the caller
 * falls back to reading it on the device's own clock, as it did before a zone
 * was recordable.
 */
export function wallClockToIso(wall: string, zone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(wall.trim());
  if (!match) return null;
  const [, y, mo, d, hh, mm] = match;
  const wallAsUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm));
  const asUtc = new Date(wallAsUtc);
  // 2026-02-30 rolls into March rather than failing; refuse it instead.
  if (asUtc.getUTCMonth() !== Number(mo) - 1 || asUtc.getUTCDate() !== Number(d)) return null;

  let minutes = zoneOffsetMinutes(zone, asUtc);
  if (minutes === null) return null;
  const settled = zoneOffsetMinutes(zone, new Date(wallAsUtc - minutes * 60_000));
  if (settled !== null && settled !== minutes) minutes = settled;
  return new Date(wallAsUtc - minutes * 60_000).toISOString();
}

/** The device's own offset at an instant, in minutes east of UTC (IST is 330). */
export function deviceOffsetMinutes(instant: Date): number {
  // getTimezoneOffset counts minutes *west* of UTC.
  return -instant.getTimezoneOffset();
}

/** The device's calendar day for a moment, as "2026-08-15". */
function localDateStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * What a moment reads as on the phone's own clock — "5:30 AM", or
 * "5:30 AM on 6 Oct" when that lands on a different day than the one typed.
 * This is the check that catches a mistaken change of zone, and it needs no
 * zone support at all: the device *is* the clock being asked about.
 */
export function deviceClockReading(iso: string, typedDate: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (localDateStamp(date) === typedDate.trim().slice(0, 10)) return time;
  const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${time} on ${day}`;
}
