import assert from "node:assert/strict";
import { test } from "node:test";
import { experienceYearsLabel, timeAgoLabel } from "./format";

test("the years tail is lifted out of an experience label", () => {
  assert.equal(experienceYearsLabel("Mid-level Designers (3-5 years)"), "(3-5 years)");
  assert.equal(experienceYearsLabel("Senior Designers (5-8 years)"), "(5-8 years)");
});

test("a label without a parenthetical stays whole", () => {
  assert.equal(experienceYearsLabel("Students"), "Students");
  assert.equal(experienceYearsLabel("Lead / Principal"), "Lead / Principal");
});

test("time labels step from minutes to hours to days to a date", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  assert.equal(timeAgoLabel("2026-10-09T11:59:30Z", now), "Just now");
  assert.equal(timeAgoLabel("2026-10-09T11:30:00Z", now), "30m ago");
  assert.equal(timeAgoLabel("2026-10-09T09:00:00Z", now), "3h ago");
  assert.equal(timeAgoLabel("2026-10-08T10:00:00Z", now), "Yesterday");
  assert.equal(timeAgoLabel("2026-10-05T12:00:00Z", now), "4d ago");
  assert.equal(timeAgoLabel("2026-09-14T12:00:00Z", now), "Sep 14");
});
