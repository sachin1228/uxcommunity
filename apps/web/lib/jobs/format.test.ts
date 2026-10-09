import assert from "node:assert/strict";
import { test } from "node:test";
import { editedLabel, experienceYearsLabel, timeAgoLabel } from "./format";

test("the years tail is lifted out of an experience label", () => {
  assert.equal(experienceYearsLabel("Mid-level Designers (3-5 years)"), "(3-5 years)");
  assert.equal(experienceYearsLabel("Senior Designers (5-8 years)"), "(5-8 years)");
});

test("a label without a parenthetical stays whole", () => {
  assert.equal(experienceYearsLabel("Students"), "Students");
  assert.equal(experienceYearsLabel("Lead / Principal"), "Lead / Principal");
});

test("an edit stamp appears only after a real edit", () => {
  const created = "2026-10-09T12:00:00Z";

  // Never edited: the database leaves updated_at null, and a posting must not
  // claim a change that did not happen.
  assert.equal(editedLabel(created, null), null);
  // An edit cannot precede or coincide with the creation.
  assert.equal(editedLabel(created, created), null);
  assert.equal(editedLabel(created, "2026-10-09T11:00:00Z"), null);
  assert.equal(editedLabel(created, "not-a-date"), null);

  assert.notEqual(editedLabel(created, "2026-10-09T13:00:00Z"), null);
  assert.match(editedLabel(created, "2026-10-09T13:00:00Z") ?? "", /^Updated /);
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
