/**
 * Event form timestamps: what the create/edit modals send and the API expects.
 *
 * The date and time inputs hand over browser wall-time — "2026-09-25" plus
 * "12:10". A naive concatenation ("2026-09-25T12:10:00") carries no zone, so
 * Postgres's session timezone (UTC) claims it and a typed 12:10 surfaces as
 * 17:40 IST on every card in the app. The fix is to state the zone explicitly:
 * the viewer typed a wall time in their own zone, so that is the zone we send.
 *
 * en-ZA is the only common locale whose fixed-format RFC-ish output is
 * "yyyy/mm/dd HH:mm:ss" — no day names, no suffixes — so the parts are parsed
 * back out of it and reassembled with offsets to a canonical ISO string.
 */
const ZONELESS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const zoneFormatter = new Intl.DateTimeFormat("en-ZA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/**
 * The wall clock the viewer sees in their own zone, as "yyyy/mm/dd, HH:mm:ss".
 * hourCycle "h23" is set per call (ES2023+ supports it in options): a 24h
 * locale like en-ZA renders midnight as "24" unless forced to "00".
 */
function zoneStamp(date: Date): string {
  return new Intl.DateTimeFormat("en-ZA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(date);
}

/**
 * A browser wall-time input ("2026-09-25" + "12:10") as the real instant it
 * names in the viewer's zone, ISO-encoded — "2026-09-25T06:40:00.000Z" for a
 * UTC+5:30 viewer. Inputs in the future or from another zone render back
 * through toISOString, so what leaves the browser is always exact.
 */
export function localInputToIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) return null;

  const [, y, mo, d] = match;
  const [, hh, mm] = timeMatch;
  const hour = Number(hh);
  const minute = Number(mm);
  if (hour > 23 || minute > 59) return null;
  // Constructed in the viewer's zone by design: the hour they typed is the
  // hour their neighbours will see, wherever the server sits.
  const local = new Date(Number(y), Number(mo) - 1, Number(d), hour, minute);
  if (Number.isNaN(local.getTime())) return null;
  // The Date constructor rolls overflow over silently (2026-02-30 becomes
  // March 2); the date inputs can't produce that, but neither should we.
  if (
    local.getFullYear() !== Number(y) ||
    local.getMonth() !== Number(mo) - 1 ||
    local.getDate() !== Number(d)
  ) {
    return null;
  }

  // The wall clock in the viewer's zone, rebuilt from the local parts so the
  // zone offset is derived from the date (DST) and not assumed.
  const stamp = zoneStamp(local);
  const wall = /^(\d{4})\/(\d{2})\/(\d{2}), (\d{2}):(\d{2}):(\d{2})$/.exec(stamp);
  if (!wall) return null;

  const [, wy, wmo, wd, wh, wm, ws] = wall;
  // Same construction, then the difference between the wall clock and the
  // constructed instant is the zone's own offset for that day.
  const asUtc = Date.UTC(Number(wy), Number(wmo) - 1, Number(wd), Number(wh), Number(wm), Number(ws));
  const offsetMs = asUtc - local.getTime();
  const sign = offsetMs < 0 ? "-" : "+";
  const abs = Math.abs(offsetMs);
  const ohh = String(Math.floor(abs / 3_600_000)).padStart(2, "0");
  const omm = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, "0");

  return `${wy}-${wmo}-${wd}T${wh}:${wm}:${ws}${sign}${ohh}:${omm}`;
}

/**
 * A UTC instant (the API's stored form, ISO with Z) as the wall time the
 * viewer's own zone shows for it, in date-input and time-input shape. Used by
 * the edit modal to prefill the same fields it will submit back.
 */
export function isoToLocalInput(iso: string | null | undefined): { date: string; time: string } | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

/**
 * How long a start can sit behind the clock and still count as upcoming: a
 * member picking "right now" needs the seconds it takes to reach the submit
 * button, but yesterday must never pass.
 */
const PAST_START_GRACE_MS = 60_000;

/**
 * Today as a `<input type="date">` value ("2026-09-25"), in the viewer's own
 * zone — the `min` that keeps the event form's date picker on days that have
 * not happened yet. The picker only constrains the day, so submit-time checks
 * still catch today-with-an-earlier-hour via isPastStart.
 */
export function todayDateInput(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The current wall clock as a `<input type="time">` value ("14:05") — the
 * `min` for a start time on today's date, so the picker can't offer an hour
 * that has already gone by.
 */
export function nowTimeInput(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * A date input shifted by whole days ("2026-09-25" + 2 → "2026-09-27"), pure
 * UTC calendar math on the string so zones and DST cannot touch it. The edit
 * form needs this to carry a legacy multi-day end (end on a later date than
 * the start) that the single date selector can no longer show.
 */
export function addDaysToDateInput(date: string, days: number): string {
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) ?? [];
  if (!y) return date;
  const shifted = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d) + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * Whole days from one date input to another (to − from). A legacy event whose
 * end lands a day or more after its start stores that distance here so the
 * end keeps riding the start's date through edits.
 */
export function daysBetweenDateInputs(from: string, to: string): number {
  const day = (d: string) => {
    const [, y, m, dd] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d) ?? [];
    return y ? Date.UTC(Number(y), Number(m) - 1, Number(dd)) / 86_400_000 : NaN;
  };
  return day(to) - day(from);
}

/**
 * What the viewer's own zone is called, for the small label beside the event
 * form's date picker — the times they type mean this zone, and the label says
 * so the way wall clocks do: the abbreviation when the runtime has one
 * ("EDT"), and the offset for this exact date ("UTC+5:30"), which is what
 * carries half-hour zones and DST. A zone without a real abbreviation (CLDR
 * deliberately refuses ambiguous ones, so India renders "GMT+5:30") shows the
 * offset alone — and the IANA name is skipped on purpose: runtimes disagree
 * on its spelling (Kolkata is still "Asia/Calcutta" in some ICU builds), and
 * a label that changes between browsers reads as two different zones.
 */
export function viewerZoneLabel(now: Date = new Date()): string {
  // getTimezoneOffset counts minutes west of UTC (IST is -330); the label
  // wants the familiar east-positive shape.
  const minutes = now.getTimezoneOffset();
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = minutes === 0
    ? "UTC"
    : `UTC${minutes < 0 ? "+" : "-"}${Math.floor(abs / 60)}:${pad(abs % 60)}`;

  // A real abbreviation ("EDT") adds something the offset can't; a GMT-style
  // one ("GMT+5:30") is the offset again under another name.
  const named = new Intl.DateTimeFormat("en", { timeZoneName: "short" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value ?? null;
  const abbrev = named && !/^(GMT|UTC)/.test(named) ? named : null;

  return abbrev ? `${abbrev} · ${offset}` : offset;
}

/**
 * The viewer's zone label as of a chosen date (see viewerZoneLabel) — an event
 * sitting on the far side of a DST change must name the offset it will actually
 * run at, not today's. Noon anchors the lookup: a date input can only name a
 * day, and noon is never inside a transition.
 */
export function zoneLabelForDateInput(date: string, fallback: Date = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return viewerZoneLabel(fallback);
  return viewerZoneLabel(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

/** How close to the start the event form starts calling it "starting soon". */
export const STARTS_SOON_WINDOW_MS = 60 * 60 * 1000;

/**
 * Whole minutes until the start, when it falls inside that window — null when
 * it is further out, has already begun, or cannot be read. Rounded up, so half
 * a minute away reads "in 1 minute" rather than "in 0 minutes".
 */
export function minutesUntilStart(
  startIso: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!startIso) return null;
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return null;
  const delta = start - now.getTime();
  if (delta <= 0 || delta > STARTS_SOON_WINDOW_MS) return null;
  return Math.max(1, Math.ceil(delta / 60_000));
}

/**
 * A start instant that has already happened (with the minute of grace above).
 * Unparseable input counts as past: every caller has already validated the
 * shape, and failing closed here can only refuse a date, never move one.
 */
export function isPastStart(iso: string, now: Date = new Date()): boolean {
  const time = Date.parse(iso);
  return !Number.isFinite(time) || time < now.getTime() - PAST_START_GRACE_MS;
}

/**
 * Whether a rebuilt start differs from the stored one by more than the form's
 * minute granularity — i.e. the member actually moved it, rather than handing
 * the stored value back. Untouched past starts must keep editing other fields
 * (a description fix on an event that already happened), so the past guard
 * only bites when this says the start itself changed.
 */
export function startMovedByEdit(rebuiltIso: string, storedIso: string): boolean {
  const rebuilt = Date.parse(rebuiltIso);
  const stored = Date.parse(storedIso);
  if (!Number.isFinite(rebuilt) || !Number.isFinite(stored)) return true;
  return Math.abs(rebuilt - stored) >= 60_000;
}

/**
 * Server-side guard: reject a timestamp that carries no zone at all
 * ("2026-09-25T12:10:00"), the shape that caused the shift — a naive value
 * would be read in the database session's zone (UTC) and land hours away from
 * what the member typed. Real instants ("…Z", "…+05:30") pass untouched.
 */
export function isZoneAwareIso(value: string): boolean {
  return !ZONELESS.test(value.trim());
}

/** Guard + parse in one step, for route handlers. */
export function requireZoneAwareIso(value: string): string | null {
  if (!isZoneAwareIso(value)) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
