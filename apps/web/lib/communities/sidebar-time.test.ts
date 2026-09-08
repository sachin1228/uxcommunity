import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSidebarTime } from "./sidebar-time";

const now = new Date(2026, 8, 8, 18, 30);
const format = (date: Date, reference = now) => formatSidebarTime(date.toISOString(), reference);

test("today uses an unambiguous 12-hour clock", () => {
  assert.equal(format(new Date(2026, 8, 8, 18, 3))?.label, "6:03 PM");
  assert.equal(format(new Date(2026, 8, 8, 9, 5))?.label, "9:05 AM");
  assert.equal(format(new Date(2026, 8, 8, 0, 0))?.label, "12:00 AM");
  assert.equal(format(new Date(2026, 8, 8, 12, 0))?.label, "12:00 PM");
});

test("yesterday means the previous local calendar day, not 24 hours ago", () => {
  assert.equal(format(new Date(2026, 8, 7, 23, 59), new Date(2026, 8, 8, 0, 1))?.label, "Yesterday");
  assert.equal(format(new Date(2026, 8, 7, 0, 1))?.label, "Yesterday");
});

test("recent messages use weekdays, then short dates after a week", () => {
  assert.equal(format(new Date(2026, 8, 4, 12))?.label, "Fri");
  assert.equal(format(new Date(2026, 8, 2, 12))?.label, "Wed");
  assert.equal(format(new Date(2026, 8, 1, 12))?.label, "Sep 1");
  assert.equal(format(new Date(2025, 8, 1, 12))?.label, "Sep 1, 2025");
});

test("calendar recency survives year boundaries and DST changes", () => {
  assert.equal(format(new Date(2025, 11, 31, 23), new Date(2026, 0, 1, 1))?.label, "Yesterday");
  assert.equal(format(new Date(2026, 2, 8, 0, 30), new Date(2026, 2, 9, 0, 15))?.label, "Yesterday");
  assert.equal(format(new Date(2026, 10, 1, 0, 15), new Date(2026, 10, 2, 23, 30))?.label, "Yesterday");
});

test("invalid timestamps are omitted and future dates are not labeled as past", () => {
  assert.equal(formatSidebarTime("invalid", now), null);
  assert.equal(formatSidebarTime("", now), null);
  assert.equal(format(new Date(2026, 8, 9, 12))?.label, "Sep 9");
});

test("exact date and time remain available for hover and assistive technology", () => {
  const date = new Date(2026, 8, 8, 18, 3);
  const result = format(date);
  assert.equal(result?.dateTime, date.toISOString());
  assert.match(result?.full ?? "", /Tuesday, September 8, 2026/);
  assert.match(result?.full ?? "", /6:03 PM/);
});
