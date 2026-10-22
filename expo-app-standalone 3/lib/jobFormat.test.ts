import { test } from "node:test";
import assert from "node:assert/strict";
import {
  closingDateFromInstant,
  closingInstantFromDate,
  criteriaMismatches,
  editedLabel,
  experienceYearsLabel,
  gateDimensions,
  jobDeadline,
  listPhrase,
  timeAgoLabel,
  type JobPost,
  type JobViewer,
} from "./jobFormat";

const NOW = new Date("2026-10-22T12:00:00.000Z");

test("relative stamps match the web reader", () => {
  assert.equal(timeAgoLabel("2026-10-22T11:59:30.000Z", NOW), "Just now");
  assert.equal(timeAgoLabel("2026-10-22T11:15:00.000Z", NOW), "45m ago");
  assert.equal(timeAgoLabel("2026-10-22T07:00:00.000Z", NOW), "5h ago");
  assert.equal(timeAgoLabel("2026-10-21T09:00:00.000Z", NOW), "Yesterday");
  assert.equal(timeAgoLabel("2026-10-19T09:00:00.000Z", NOW), "3d ago");
  assert.equal(timeAgoLabel("2026-10-02T09:00:00.000Z", NOW), "Oct 2");
  assert.equal(timeAgoLabel("not-a-date", NOW), "");
});

test("an edit stamp only exists when the save changed something", () => {
  assert.equal(editedLabel("2026-10-20T00:00:00.000Z", null), null);
  assert.equal(editedLabel("2026-10-20T00:00:00.000Z", "2026-10-20T00:00:00.000Z"), null);
  const label = editedLabel("2026-10-20T00:00:00.000Z", "2026-10-20T10:00:00.000Z");
  assert.ok(label?.startsWith("Updated "));
});

test("a closing date means the end of that UTC day", () => {
  assert.equal(closingInstantFromDate("2026-10-24"), "2026-10-24T23:59:59.999Z");
  assert.equal(closingInstantFromDate(""), null);
  assert.equal(closingInstantFromDate("24-10-2026"), null);
  // A rolled-over impossible day is not a date the poster typed.
  assert.equal(closingInstantFromDate("2026-02-31"), null);
  assert.equal(closingDateFromInstant("2026-10-24T23:59:59.999Z"), "2026-10-24");
});

test("deadline labels separate the calendar from the owner's decision", () => {
  assert.deepEqual(jobDeadline({ status: "open", closes_at: null }, NOW), { kind: "none" });
  assert.deepEqual(
    jobDeadline({ status: "closed", closes_at: "2026-10-24T23:59:59.999Z" }, NOW),
    { kind: "none" },
  );
  assert.deepEqual(
    jobDeadline({ status: "open", closes_at: "2026-10-24T23:59:59.999Z" }, NOW),
    { kind: "open", label: "Closes Oct 24" },
  );
  assert.deepEqual(
    jobDeadline({ status: "open", closes_at: "2026-10-21T23:59:59.999Z" }, NOW),
    { kind: "expired", label: "Expired Oct 21" },
  );
});

test("experience years read out of the label, falling back to the label", () => {
  assert.equal(experienceYearsLabel("Mid-level Designers (3-5 years)"), "(3-5 years)");
  assert.equal(experienceYearsLabel("Senior Designers"), "Senior Designers");
});

test("criteria mismatches ignore the All wildcards", () => {
  const job = {
    city_id: null,
    sector_id: "sector-1",
    job_title: "product-designer",
    experience_level: "mid",
  } as JobPost;
  const viewer = {
    cityId: "city-1",
    sectorId: "sector-1",
    jobTitle: "product-designer",
    experienceLevel: "senior",
  } as JobViewer;

  assert.deepEqual(criteriaMismatches(job, viewer), ["experience level"]);
  assert.deepEqual(
    criteriaMismatches({ ...job, city_id: "city-2" } as JobPost, viewer),
    ["city", "experience level"],
  );
});

test("gate dimensions name only the real filters", () => {
  const job = { city_id: null, sector_id: "s", job_title: "t", experience_level: "e" } as JobPost;
  assert.deepEqual(gateDimensions(job), ["sector", "job title", "experience level"]);
  assert.equal(listPhrase(["city", "sector", "job title"]), "city, sector and job title");
  assert.equal(listPhrase(["city"]), "city");
  assert.equal(listPhrase([]), "");
});
