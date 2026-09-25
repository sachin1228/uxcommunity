import { test } from "node:test";
import assert from "node:assert/strict";
import { localInputToIso } from "./event-time";
import {
  CURATED_TIME_ZONES,
  canonicalZoneId,
  formatUtcOffsetMinutes,
  isKnownTimeZone,
  timeZoneChoices,
  wallTimeAtOffset,
  wallTimeInputsInZone,
  zoneAbbreviation,
  zoneLabelInZone,
  zoneOffsetMinutes,
} from "./timezone";

const JULY = new Date("2026-07-15T12:00:00Z");
const JANUARY = new Date("2026-01-15T12:00:00Z");

test("every zone the picker offers is one the runtime can actually resolve", () => {
  for (const id of CURATED_TIME_ZONES) {
    assert.ok(isKnownTimeZone(id), `${id} does not resolve`);
    // Canonicalising is what keeps an alias and its modern spelling from
    // becoming two rows for the same zone.
    assert.ok(canonicalZoneId(id), `${id} has no canonical form`);
    assert.notEqual(zoneOffsetMinutes(id, JULY), null, `${id} has no offset`);
  }
});

test("the picker keeps every fractional offset a whole-hour list would lose", () => {
  const offsets = (ref: Date) =>
    new Set(
      CURATED_TIME_ZONES.map((id) => zoneOffsetMinutes(id, ref)).filter((m): m is number => m !== null),
    );
  // Every offset the world actually uses must be reachable at some date —
  // otherwise a host somewhere has no row to pick. A failure here means this
  // runtime gained an offset: add a zone that sits in it.
  const world = new Set(
    Intl.supportedValuesOf("timeZone")
      .flatMap((id) => [zoneOffsetMinutes(id, JULY), zoneOffsetMinutes(id, JANUARY)])
      .filter((m): m is number => m !== null),
  );
  const reachable = new Set([...offsets(JULY), ...offsets(JANUARY)]);
  for (const offset of world) {
    if (offset % 60 === 0) continue; // whole hours are covered below
    assert.ok(reachable.has(offset), `no zone offers ${formatUtcOffsetMinutes(offset)}`);
  }
  // Newfoundland is the half-hour zone that only shows up in its own winter.
  assert.ok(offsets(JANUARY).has(-210), "no zone offers UTC-3:30");
  assert.equal(zoneOffsetMinutes("America/St_Johns", JANUARY), -210);
  assert.equal(zoneOffsetMinutes("America/St_Johns", JULY), -150);
  // And the answer must be instant-aware either way.
  assert.equal(zoneOffsetMinutes("Australia/Sydney", JULY), 600);
  assert.equal(zoneOffsetMinutes("Australia/Sydney", JANUARY), 660);
  assert.equal(zoneOffsetMinutes("Europe/London", JANUARY), 0);
});

test("an abbreviation is only shown when the zone really has one", () => {
  assert.equal(zoneAbbreviation("America/New_York", JULY), "EDT");
  assert.equal(zoneAbbreviation("America/New_York", JANUARY), "EST");
  // CLDR refuses ambiguous abbreviations, so India renders as an offset name,
  // which would just repeat the offset the label already carries.
  assert.equal(zoneAbbreviation("Asia/Kolkata", JULY), null);
  assert.equal(zoneLabelInZone("Asia/Kolkata", JULY), "UTC+5:30");
  assert.equal(zoneLabelInZone("America/New_York", JULY), "EDT · UTC-4:00");
  assert.equal(zoneLabelInZone("Not/AZone", JULY), null);
});

test("aliases and modern spellings collapse to one handle", () => {
  // The runtime's own spellings are the legacy ones; the modern name must land
  // on the same handle rather than a second row.
  assert.equal(canonicalZoneId("Asia/Kolkata"), canonicalZoneId("Asia/Calcutta"));
  assert.equal(canonicalZoneId("Europe/Kyiv"), canonicalZoneId("Europe/Kiev"));
  assert.equal(canonicalZoneId("US/Eastern"), canonicalZoneId("America/New_York"));
  assert.equal(isKnownTimeZone("Not/AZone"), false);
  assert.equal(canonicalZoneId("Not/AZone"), null);
});

test("minutes east of UTC are labelled with one convention", () => {
  assert.equal(formatUtcOffsetMinutes(0), "UTC");
  assert.equal(formatUtcOffsetMinutes(330), "UTC+5:30");
  assert.equal(formatUtcOffsetMinutes(-240), "UTC-4:00");
  assert.equal(formatUtcOffsetMinutes(765), "UTC+12:45");
});

test("a moment reads as a wall clock — and a calendar day — in any zone", () => {
  // 20:00 UTC is already the next morning in Tokyo.
  assert.deepEqual(wallTimeInputsInZone("2026-09-25T20:00:00Z", "Asia/Tokyo"), {
    date: "2026-09-26",
    time: "05:00",
  });
  // Midnight is "00:00", not "24:00".
  assert.deepEqual(wallTimeInputsInZone("2026-09-24T18:30:00Z", "Asia/Kolkata"), {
    date: "2026-09-25",
    time: "00:00",
  });
  assert.equal(wallTimeInputsInZone("2026-09-25T20:00:00Z", "Not/AZone"), null);
  assert.equal(wallTimeInputsInZone(null, "Asia/Tokyo"), null);
  assert.equal(wallTimeInputsInZone("not a date", "Asia/Tokyo"), null);
});

test("a stored offset reconstructs the host's clock without their zone name", () => {
  // 3 PM EDT, the reading the host gave, rebuilt from minutes alone.
  assert.equal(wallTimeAtOffset("2026-07-15T19:00:00Z", -240), "3:00 PM");
  assert.equal(wallTimeAtOffset("2026-07-15T19:00:00Z", 330), "12:30 AM");
  assert.equal(wallTimeAtOffset("not a date", -240), "");
});

test("the picker's rows carry a name a member can read, never a raw zone id", () => {
  const rows = timeZoneChoices(JULY, ["Asia/Calcutta"]);
  for (const row of rows) {
    assert.ok(row.label.trim().length > 0, `${row.value} has no label`);
    assert.ok(!row.label.includes("/"), `${row.value} shows a raw zone id`);
  }
  // A place is paired with the offset it sits on — except UTC, which names no
  // place and would otherwise read as "UTC · UTC".
  assert.ok(rows.some((row) => row.value === "UTC" && row.label === "UTC"));
  for (const row of rows.filter((r) => r.value !== "UTC")) {
    assert.ok(row.label.includes(" · "), `${row.value} has no offset`);
  }
  // Every curated zone is reachable, and no zone appears twice: the device's
  // own alias canonicalises onto the curated spelling rather than adding a
  // second row for the same offset.
  const values = rows.map((row) => row.value);
  assert.equal(new Set(values).size, values.length, "duplicate zone rows");
  for (const id of CURATED_TIME_ZONES) {
    assert.ok(values.includes(canonicalZoneId(id)!), `${id} is missing from the picker`);
  }
  assert.ok(values.includes("Asia/Calcutta"), "the caller's own zone went missing");
  assert.ok(rows.some((row) => row.label.startsWith("Kolkata ·")), "Kolkata lost its modern name");
  assert.ok(rows.some((row) => row.label.startsWith("Kathmandu ·")), "Kathmandu lost its modern name");
});

test("the picker's offsets follow the date they are labelled for", () => {
  const summer = timeZoneChoices(JULY, []).find((row) => row.value === "America/New_York");
  const winter = timeZoneChoices(JANUARY, []).find((row) => row.value === "America/New_York");
  assert.equal(summer?.label, "New York · EDT · UTC-4:00");
  assert.equal(winter?.label, "New York · EST · UTC-5:00");
});

test("a zone outside the curated table is still offered, named from its own id", () => {
  // Not every place a member lives is in the table; the device's zone must
  // still be selectable rather than silently dropped.
  const rows = timeZoneChoices(JULY, ["Pacific/Enderbury"]);
  assert.ok(rows.some((row) => row.value === "Pacific/Enderbury" && row.label.startsWith("Enderbury ·")));
});

test("an event prefilled in its own zone reads back as the same instant", () => {
  // The edit form's round trip: a New York event opened by an editor elsewhere
  // must come back to the same moment, or every save would nudge the event.
  const stored = "2026-07-15T19:00:00.000Z";
  const inputs = wallTimeInputsInZone(stored, "America/New_York");
  assert.deepEqual(inputs, { date: "2026-07-15", time: "15:00" });
  const rebuilt = localInputToIso(inputs!.date, inputs!.time, "America/New_York");
  assert.equal(Date.parse(rebuilt!), Date.parse(stored));
});
