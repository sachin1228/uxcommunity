import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closingDateFromInstant,
  closingInstantFromDate,
  deadlineFields,
  editedLabel,
  experienceYearsLabel,
  jobDeadline,
  timeAgoLabel,
} from "./format";

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

test("a closing date means the end of that day", () => {
  assert.equal(closingInstantFromDate("2026-10-24"), "2026-10-24T23:59:59.999Z");
  // The inverse, which is what the edit form prefills.
  assert.equal(closingDateFromInstant("2026-10-24T23:59:59.999Z"), "2026-10-24");
});

test("an impossible or malformed closing date is refused", () => {
  // February has no 31st, and the shape check alone would let it through.
  assert.equal(closingInstantFromDate("2026-02-31"), null);
  assert.equal(closingInstantFromDate("24-10-2026"), null);
  assert.equal(closingInstantFromDate("2026-10-24T00:00:00Z"), null);
  assert.equal(closingInstantFromDate(""), null);
});

test("a deadline reads as Closes before its day and Expired after it", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  // No deadline at all, and an owner-closed posting: neither reads as a date.
  assert.deepEqual(jobDeadline({ status: "open", closes_at: null }, now), { kind: "none" });
  assert.deepEqual(
    jobDeadline({ status: "closed", closes_at: "2026-10-24T23:59:59.999Z" }, now),
    { kind: "none" }
  );

  assert.deepEqual(jobDeadline({ status: "open", closes_at: "2026-10-24T23:59:59.999Z" }, now), {
    kind: "open",
    label: "Closes Oct 24",
  });
  assert.deepEqual(jobDeadline({ status: "open", closes_at: "2026-10-19T23:59:59.999Z" }, now), {
    kind: "expired",
    label: "Expired Oct 19",
  });
  assert.deepEqual(jobDeadline({ status: "open", closes_at: "not-a-date" }, now), {
    kind: "none",
  });
});

test("the deadline fields come from one reading of the clock", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  assert.deepEqual(deadlineFields({ status: "open", closes_at: null }, now), {
    deadline_label: null,
    deadline_expired: false,
  });
  assert.deepEqual(deadlineFields({ status: "open", closes_at: "2026-10-19T23:59:59.999Z" }, now), {
    deadline_label: "Expired Oct 19",
    deadline_expired: true,
  });
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
