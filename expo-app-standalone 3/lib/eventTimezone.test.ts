import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURATED_ZONES,
  canonicalZone,
  deviceClockReading,
  deviceOffsetMinutes,
  formatOffset,
  timeZoneChoices,
  timeZoneIsSupported,
  wallClockInZone,
  wallClockToIso,
  zoneLabel,
  zoneOffsetMinutes,
} from "./eventTimezone";

const JULY = new Date("2026-07-15T12:00:00Z");
const JANUARY = new Date("2026-01-15T12:00:00Z");

/**
 * Runs assertions with the phone's zone frozen, the same pattern the web suites
 * use — V8 re-reads process.env.TZ between Date calls, so a frozen process
 * makes an expected device-clock string hold wherever the suite runs.
 */
function withZone<T>(tz: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    process.env.TZ = previous;
    const probe = new Date(0);
    void probe;
  }
}

test("the runtime can read a named zone, which is what the picker depends on", () => {
  // Node ships full ICU. On a phone this is the check that decides whether the
  // composer offers the picker at all, so the answer must be a real one.
  assert.equal(timeZoneIsSupported(), true);
});

test("every zone the picker offers resolves, and every row names a place", () => {
  const rows = timeZoneChoices(JULY, []);
  for (const row of rows) {
    assert.ok(row.label.trim().length > 0, `${row.zone} has no label`);
    assert.ok(!row.label.includes("/"), `${row.zone} shows a raw zone id`);
  }
  // Each curated zone is reachable, and nothing is listed twice.
  const zones = rows.map((row) => row.zone);
  assert.equal(new Set(zones).size, zones.length, "duplicate zone rows");
  for (const zone of CURATED_ZONES) {
    assert.ok(zones.includes(canonicalZone(zone)!), `${zone} is missing from the picker`);
  }
  // UTC names no place, so it stands alone rather than reading "UTC · UTC".
  assert.ok(rows.some((row) => row.zone === "UTC" && row.label === "UTC"));
});

test("the picker still reaches every offset the world uses", () => {
  const world = new Set(
    Intl.supportedValuesOf("timeZone")
      .flatMap((zone) => [zoneOffsetMinutes(zone, JULY), zoneOffsetMinutes(zone, JANUARY)])
      .filter((minutes): minutes is number => minutes !== null),
  );
  const reachable = new Set(
    CURATED_ZONES.flatMap((zone) => [zoneOffsetMinutes(zone, JULY), zoneOffsetMinutes(zone, JANUARY)]),
  );
  // A failure here means the table lost a zone somewhere a host could be: add
  // one that sits in the missing offset.
  for (const minutes of world) {
    assert.ok(reachable.has(minutes), `no zone offers ${formatOffset(minutes)}`);
  }
  // And the fractional offsets are the point of the table.
  for (const minutes of [330, 345, 270, 210, 390, 525, 570, 630, 765, -210, -570]) {
    assert.ok(reachable.has(minutes), `no zone offers ${formatOffset(minutes)}`);
  }
});

test("aliases and modern spellings collapse to one handle", () => {
  assert.equal(canonicalZone("Asia/Kolkata"), canonicalZone("Asia/Calcutta"));
  assert.equal(canonicalZone("Europe/Kyiv"), canonicalZone("Europe/Kiev"));
  assert.equal(canonicalZone("US/Eastern"), canonicalZone("America/New_York"));
  assert.equal(canonicalZone("Not/AZone"), null);
  assert.equal(zoneOffsetMinutes("Not/AZone", JULY), null);
});

test("a zone's offset follows the date it is labelled for", () => {
  assert.equal(zoneOffsetMinutes("America/New_York", JULY), -240);
  assert.equal(zoneOffsetMinutes("America/New_York", JANUARY), -300);
  assert.equal(zoneLabel("America/New_York", JULY), "EDT · UTC-4:00");
  assert.equal(zoneLabel("America/New_York", JANUARY), "EST · UTC-5:00");
  // CLDR refuses ambiguous abbreviations, so India shows its offset alone.
  assert.equal(zoneLabel("Asia/Kolkata", JULY), "UTC+5:30");
  assert.equal(formatOffset(345), "UTC+5:45");
  assert.equal(formatOffset(0), "UTC");
});

test("a typed wall clock becomes the instant it names in the chosen zone", () => {
  // 15:00 in New York in July is 19:00 UTC — read on a device that thinks in
  // another zone entirely.
  assert.equal(wallClockToIso("2026-07-15 15:00", "America/New_York"), "2026-07-15T19:00:00.000Z");
  assert.equal(wallClockToIso("2026-01-15 15:00", "America/New_York"), "2026-01-15T20:00:00.000Z");
  assert.equal(wallClockToIso("2026-10-05 15:00", "Asia/Kolkata"), "2026-10-05T09:30:00.000Z");
  // The T separator is what a stored value looks like coming back in.
  assert.equal(wallClockToIso("2026-10-05T15:00", "Asia/Kolkata"), "2026-10-05T09:30:00.000Z");
});

test("text or zones the phone cannot honour yield nothing, never a guess", () => {
  // A null here is what makes the composer keep the device's own reading
  // instead of silently filing the event under a zone it could not resolve.
  assert.equal(wallClockToIso("next tuesday", "Asia/Kolkata"), null);
  assert.equal(wallClockToIso("2026-02-30 15:00", "Asia/Kolkata"), null);
  assert.equal(wallClockToIso("2026-10-05 15:00", "Not/AZone"), null);
  assert.equal(wallClockInZone("2026-10-05T09:30:00Z", "Not/AZone"), null);
  assert.equal(wallClockInZone("not a date", "Asia/Kolkata"), null);
});

test("an event opens on the clock it was created in and comes back unchanged", () => {
  // The edit prefill: a New York event opened on a phone set to India must show
  // 3 PM, and saving it back untouched must name the same moment.
  const stored = "2026-07-15T19:00:00.000Z";
  const wall = wallClockInZone(stored, "America/New_York");
  assert.equal(wall, "2026-07-15 15:00");
  assert.equal(Date.parse(wallClockToIso(wall!, "America/New_York")!), Date.parse(stored));
  // And the same moment read on the phone's own clock is a different wall time
  // — which is exactly why the prefill cannot use the device's zone.
  assert.equal(wallClockInZone(stored, "Asia/Kolkata"), "2026-07-16 00:30");
});

test("the picker's rows are labelled for the day being scheduled", () => {
  const july = timeZoneChoices(JULY, []).find((row) => row.zone === "America/New_York");
  const january = timeZoneChoices(JANUARY, []).find((row) => row.zone === "America/New_York");
  assert.equal(july?.label, "New York · EDT · UTC-4:00");
  assert.equal(january?.label, "New York · EST · UTC-5:00");
  // The phone's own zone is folded in even when the table never names it.
  const extra = timeZoneChoices(JULY, ["Pacific/Enderbury"]);
  assert.ok(extra.some((row) => row.zone === "Pacific/Enderbury" && row.label.startsWith("Enderbury ·")));
});

test("the device's own reading comes from the device, day included only when it differs", () => {
  withZone("Asia/Kolkata", () => {
    // 3 PM on the 5th in New York is half past midnight on the 6th in India,
    // which the host needs to hear about. The words are the phone's locale's,
    // so only the numbers and the presence of a day are asserted.
    const crossing = deviceClockReading("2026-10-05T19:00:00Z", "2026-10-05");
    assert.match(crossing ?? "", /12:30/);
    assert.match(crossing ?? "", / on /);
    assert.match(crossing ?? "", /Oct/);
    assert.match(crossing ?? "", /6/);

    // A moment landing on the day that was typed mentions no day at all.
    const sameDay = deviceClockReading("2026-10-05T07:00:00Z", "2026-10-05");
    assert.match(sameDay ?? "", /12:30/);
    assert.doesNotMatch(sameDay ?? "", / on /);

    assert.equal(deviceClockReading("not a date", "2026-10-05"), null);
    assert.equal(deviceOffsetMinutes(new Date("2026-10-05T07:00:00Z")), 330);
  });
});
