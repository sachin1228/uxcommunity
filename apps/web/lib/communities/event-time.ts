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
