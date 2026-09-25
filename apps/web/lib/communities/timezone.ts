/**
 * Timezone arithmetic and the zone choices an event host can pick from.
 *
 * Everywhere else the app asks the runtime what a moment reads as; this module
 * is the one place that answers the questions the rest of the app composes:
 * what a zone is called at an instant, how many minutes east of UTC it sits,
 * and what instant a typed wall clock names inside it.
 *
 * Two facts about the runtime shape the code below:
 *
 *   1. Offsets come from `Intl` and are read at a specific instant, never
 *      assumed — that is what makes DST fall out for free (New York is UTC-5
 *      in January and UTC-4 in July, and the label says which).
 *   2. `Intl` disagrees with itself about spellings across builds: this one
 *      enumerates and reports `Asia/Calcutta` and `Asia/Katmandu`, not the
 *      modern names, and knows nothing of `UTC`. So zone *ids* are treated as
 *      opaque handles (canonicalised on the way in, so an alias and its
 *      modern spelling collapse to one entry) and every name a member reads
 *      is a label this module builds, never a raw IANA id.
 */

/** How many minutes east of UTC a zone is right now, or null if unknown. */
export function zoneOffsetMinutes(timeZone: string, instant: Date): number | null {
  if (!isKnownTimeZone(timeZone)) return null;
  const part =
    new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(instant)
      .find((entry) => entry.type === "timeZoneName")?.value ?? "";
  // "GMT+05:30" / "GMT-04:00"; a zone sitting exactly on UTC renders as "GMT".
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part);
  if (!match) return /^(GMT|UTC)$/.test(part) ? 0 : null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Whether this runtime can format in the named zone at all. */
export function isKnownTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    // An unknown or malformed name must never throw into a render.
    return false;
  }
}

/**
 * The spelling this runtime uses for a zone, so every alias of it collapses to
 * one handle: "Asia/Kolkata" and "Asia/Calcutta" are the same entry here, and
 * "US/Eastern" is "America/New_York". Null when the name means nothing.
 */
export function canonicalZoneId(timeZone: string): string | null {
  if (!isKnownTimeZone(timeZone)) return null;
  try {
    return new Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * The zone's own abbreviation at an instant ("EDT"), when it has a real one.
 * CLDR refuses ambiguous ones, so India comes back as "GMT+5:30" — filtered
 * out here, since that is just the offset under another name.
 */
export function zoneAbbreviation(timeZone: string, instant: Date): string | null {
  if (!isKnownTimeZone(timeZone)) return null;
  const named =
    new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "short" })
      .formatToParts(instant)
      .find((entry) => entry.type === "timeZoneName")?.value ?? null;
  return named && !/^(GMT|UTC)/.test(named) ? named : null;
}

/**
 * Minutes east of UTC written as a label — "UTC+5:30" for IST (330), "UTC-4:00"
 * for EDT (-240), plain "UTC" at zero. One convention across the app: minutes
 * east, the same sign the ISO offsets the API receives already carry.
 */
export function formatUtcOffsetMinutes(minutesEast: number): string {
  if (minutesEast === 0) return "UTC";
  const abs = Math.abs(minutesEast);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `UTC${minutesEast < 0 ? "-" : "+"}${Math.floor(abs / 60)}:${pad(abs % 60)}`;
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
export function wallTimeInZone(iso: string, timeZone: string): string {
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
export function wallTimeAtOffset(iso: string, minutesEast: number): string {
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

/**
 * A moment as the wall clock of a named zone, in the shape the event form's
 * date and time inputs take. The edit form needs this for an event whose zone
 * is not the editor's: prefilling the device's own clock and then reading the
 * typed times in the event's zone would move the event on every save.
 */
export function wallTimeInputsInZone(
  iso: string | null | undefined,
  timeZone: string,
): { date: string; time: string } | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  if (!isKnownTimeZone(timeZone)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  const [year, month, day, hour, minute] = ["year", "month", "day", "hour", "minute"].map(part);
  if (!year || !month || !day || !hour || !minute) return null;
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

// ─── The zones a host can choose from ───────────────────────────────────────

/**
 * The zones offered by the event form's picker — one per place a member might
 * actually be, rather than all 418 the runtime enumerates. The full list is
 * mostly the same offset spelled out for neighbouring towns, and its ids are
 * the runtime's own 1970s-era spellings ("Asia/Calcutta", "Europe/Kiev"),
 * which is why each row carries the name a member reads instead. Ids are
 * canonicalised on the way out, so a device reporting an alias lands on the
 * same entry as the modern spelling.
 *
 * Between them these rows reach every offset in use anywhere — including the
 * fractional ones a naive hour-only picker gets wrong (5:30, 5:45, 4:30,
 * 3:30, 6:30, 8:45, 9:30, 10:30, 12:45, 13:45, -2:30, -3:30, -9:30) and the
 * three-and-a-half-hour gaps between whole hours. `timezone.test.ts` proves
 * every id resolves and that the table still reaches the whole world's
 * offsets, so a runtime that gains a new one fails the suite instead of
 * quietly making that zone unpickable.
 */
const TIME_ZONE_CHOICES: Array<[id: string, city: string]> = [
  ["UTC", "UTC"],
  ["Pacific/Honolulu", "Honolulu"],
  ["Pacific/Midway", "Midway"],
  ["Pacific/Marquesas", "Marquesas Islands"],
  ["America/Anchorage", "Anchorage"],
  ["America/Los_Angeles", "Los Angeles"],
  ["America/Vancouver", "Vancouver"],
  ["America/Denver", "Denver"],
  ["America/Phoenix", "Phoenix"],
  ["America/Chicago", "Chicago"],
  ["America/Mexico_City", "Mexico City"],
  ["America/New_York", "New York"],
  ["America/Toronto", "Toronto"],
  ["America/Bogota", "Bogotá"],
  ["America/Lima", "Lima"],
  ["America/Caracas", "Caracas"],
  ["America/Halifax", "Halifax"],
  ["America/Santiago", "Santiago"],
  ["America/Sao_Paulo", "São Paulo"],
  ["America/Argentina/Buenos_Aires", "Buenos Aires"],
  ["America/Montevideo", "Montevideo"],
  ["America/Noronha", "Fernando de Noronha"],
  ["America/St_Johns", "St. John's"],
  ["Atlantic/Azores", "Azores"],
  ["Atlantic/Cape_Verde", "Cape Verde"],
  ["Atlantic/Reykjavik", "Reykjavik"],
  ["Africa/Casablanca", "Casablanca"],
  ["Africa/Accra", "Accra"],
  ["Africa/Lagos", "Lagos"],
  ["Africa/Algiers", "Algiers"],
  ["Africa/Cairo", "Cairo"],
  ["Africa/Johannesburg", "Johannesburg"],
  ["Africa/Nairobi", "Nairobi"],
  ["Africa/Addis_Ababa", "Addis Ababa"],
  ["Europe/London", "London"],
  ["Europe/Dublin", "Dublin"],
  ["Europe/Lisbon", "Lisbon"],
  ["Europe/Madrid", "Madrid"],
  ["Europe/Paris", "Paris"],
  ["Europe/Brussels", "Brussels"],
  ["Europe/Amsterdam", "Amsterdam"],
  ["Europe/Berlin", "Berlin"],
  ["Europe/Zurich", "Zurich"],
  ["Europe/Rome", "Rome"],
  ["Europe/Vienna", "Vienna"],
  ["Europe/Prague", "Prague"],
  ["Europe/Warsaw", "Warsaw"],
  ["Europe/Stockholm", "Stockholm"],
  ["Europe/Oslo", "Oslo"],
  ["Europe/Copenhagen", "Copenhagen"],
  ["Europe/Helsinki", "Helsinki"],
  ["Europe/Athens", "Athens"],
  ["Europe/Bucharest", "Bucharest"],
  ["Europe/Istanbul", "Istanbul"],
  ["Europe/Kyiv", "Kyiv"],
  ["Europe/Moscow", "Moscow"],
  ["Asia/Jerusalem", "Jerusalem"],
  ["Asia/Beirut", "Beirut"],
  ["Asia/Amman", "Amman"],
  ["Asia/Riyadh", "Riyadh"],
  ["Asia/Kuwait", "Kuwait City"],
  ["Asia/Baghdad", "Baghdad"],
  ["Asia/Tehran", "Tehran"],
  ["Asia/Dubai", "Dubai"],
  ["Asia/Muscat", "Muscat"],
  ["Asia/Baku", "Baku"],
  ["Asia/Karachi", "Karachi"],
  ["Asia/Tashkent", "Tashkent"],
  ["Asia/Kabul", "Kabul"],
  ["Asia/Kolkata", "Kolkata"],
  ["Asia/Colombo", "Colombo"],
  ["Asia/Kathmandu", "Kathmandu"],
  ["Asia/Dhaka", "Dhaka"],
  ["Asia/Almaty", "Almaty"],
  ["Asia/Yangon", "Yangon"],
  ["Asia/Bangkok", "Bangkok"],
  ["Asia/Jakarta", "Jakarta"],
  ["Asia/Ho_Chi_Minh", "Ho Chi Minh City"],
  ["Asia/Singapore", "Singapore"],
  ["Asia/Kuala_Lumpur", "Kuala Lumpur"],
  ["Asia/Manila", "Manila"],
  ["Asia/Shanghai", "Shanghai"],
  ["Asia/Hong_Kong", "Hong Kong"],
  ["Asia/Taipei", "Taipei"],
  ["Asia/Seoul", "Seoul"],
  ["Asia/Tokyo", "Tokyo"],
  ["Australia/Perth", "Perth"],
  ["Australia/Adelaide", "Adelaide"],
  ["Australia/Darwin", "Darwin"],
  ["Australia/Brisbane", "Brisbane"],
  ["Australia/Lord_Howe", "Lord Howe Island"],
  ["Australia/Eucla", "Eucla"],
  ["Australia/Sydney", "Sydney"],
  ["Australia/Melbourne", "Melbourne"],
  ["Pacific/Guam", "Guam"],
  ["Pacific/Auckland", "Auckland"],
  ["Pacific/Fiji", "Fiji"],
  ["Pacific/Chatham", "Chatham Islands"],
  ["Pacific/Tongatapu", "Nuku'alofa"],
  ["Pacific/Kiritimati", "Kiritimati"],
];

/**
 * The place a zone names, in the spelling a member should read rather than the
 * runtime's own. Zones outside the curated table fall back to their id, so
 * even an unloved corner of the world gets a label instead of a blank row.
 */
export function timeZoneName(zone: string): string {
  const canonical = canonicalZoneId(zone);
  if (!canonical) return zone;
  return CURATED_NAMES.get(canonical) ?? cityFromZoneId(canonical);
}

export interface TimeZoneChoice {
  /** The canonical zone id the form submits. */
  value: string;
  /** "Kolkata · IST · UTC+5:30" — what the picker row reads as. */
  label: string;
}

/** The curated rows keyed by the canonical id, so aliases share one name. */
const CURATED_NAMES = new Map<string, string>();
for (const [id, city] of TIME_ZONE_CHOICES) {
  const canonical = canonicalZoneId(id);
  if (canonical) CURATED_NAMES.set(canonical, city);
}

/** A city name from an id, for zones that aren't in the curated table above. */
function cityFromZoneId(id: string): string {
  const [, ...rest] = id.split("/");
  if (rest.length === 0) return id; // "UTC" and friends name no place
  const [region, city] = rest.length > 1 ? [rest[0], rest[rest.length - 1]] : [null, rest[0]];
  const named = city.replace(/_/g, " ");
  return region && /^[A-Z][a-z]+$/.test(region) ? `${named}, ${region.replace(/_/g, " ")}` : named;
}

/**
 * The picker's rows, labelled for one instant so the offsets shown are the
 * ones that will actually apply — an event in January must not be filed under
 * July's offsets. `extra` ids (the device's own zone, and the zone an event
 * was created in) are folded in when the curated table doesn't already cover
 * them, so neither can ever be missing from the list.
 */
export function timeZoneChoices(ref: Date, extra: Array<string | null | undefined> = []): TimeZoneChoice[] {
  const seen = new Set<string>();
  const rows: Array<TimeZoneChoice & { minutes: number }> = [];
  const add = (id: string) => {
    const zone = canonicalZoneId(id);
    if (!zone || seen.has(zone)) return;
    const minutes = zoneOffsetMinutes(zone, ref);
    if (minutes === null) return;
    seen.add(zone);
    const label = zoneLabelInZone(zone, ref) ?? formatUtcOffsetMinutes(minutes);
    const name = timeZoneName(zone);
    // "UTC" is its own offset; every other zone pairs a place with one.
    rows.push({ value: zone, label: name === label ? name : `${name} · ${label}`, minutes });
  };

  for (const [id] of TIME_ZONE_CHOICES) add(id);
  for (const id of extra) if (id) add(id);
  // Sorted by offset so neighbouring zones sit together — searching by place
  // and scanning by offset both work on the same list.
  return rows
    .sort((a, b) => a.minutes - b.minutes || a.label.localeCompare(b.label))
    .map(({ value, label }) => ({ value, label }));
}

/** Every zone the picker can offer, for tests to hold the table to. */
export const CURATED_TIME_ZONES: readonly string[] = TIME_ZONE_CHOICES.map(([id]) => id);
