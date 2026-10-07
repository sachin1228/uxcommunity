import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isCatchAllName,
  officialGroupName,
  previewGroup,
  slotForDimension,
  slotUnlockDate,
} from "./identity";

// The naming formulas are a three-way contract (auto-join.ts at signup,
// update_profile_identity() in SQL, and this preview). If one drifts, the
// modal would promise a group the database never creates.

test("city groups are named '{City} Designers'", () => {
  assert.equal(officialGroupName("city", "Pune"), "Pune Designers");
});

test("sector groups are named '{Sector} Community'", () => {
  assert.equal(officialGroupName("sector", "Healthcare & MedTech"), "Healthcare & MedTech Community");
});

test("experience level and job title groups carry the admin-managed name as-is", () => {
  assert.equal(officialGroupName("experience_level", "Mid-Level Designers"), "Mid-Level Designers");
  assert.equal(officialGroupName("job_title", "Product Designer"), "Product Designer");
});

test("the catch-all 'Other' is recognised in any casing or padding", () => {
  for (const name of ["Other", "other", " OTHER ", "oTher"]) {
    assert.equal(isCatchAllName(name), true, `${name} should be catch-all`);
  }
  assert.equal(isCatchAllName("Otherville"), false);
  assert.equal(isCatchAllName(null), false);
  assert.equal(isCatchAllName(undefined), false);
  assert.equal(isCatchAllName(""), false);
});

test("a catch-all selection previews as no group", () => {
  assert.equal(previewGroup("city", { id: "x", name: "Other", image_url: null }), null);
  assert.equal(previewGroup("sector", { id: "x", name: " other ", image_url: "u" }), null);
});

test("a real selection previews the named group with the master image", () => {
  assert.deepEqual(
    previewGroup("city", { id: "x", name: "Mumbai", image_url: "https://img/mumbai.png" }),
    { name: "Mumbai Designers", image_url: "https://img/mumbai.png" },
  );
  assert.deepEqual(
    previewGroup("job_title", { id: "product_designer", name: "Product Designer", image_url: null }),
    { name: "Product Designer", image_url: null },
  );
});

// Designation is ONE cooldown slot covering both halves, so editing either
// the seniority or the title spends the same three months.
test("experience level and job title share the designation slot", () => {
  assert.equal(slotForDimension("experience_level"), "designation");
  assert.equal(slotForDimension("job_title"), "designation");
  assert.equal(slotForDimension("city"), "city");
  assert.equal(slotForDimension("sector"), "sector");
});

// The unlock date mirrors Postgres' `+ interval '3 months'`, which clamps to
// the target month's last day — naive JS month arithmetic would say May 1.
test("the unlock date is three calendar months later, clamped at month end", () => {
  assert.deepEqual(slotUnlockDate("2026-01-15T10:00:00Z"), new Date(Date.UTC(2026, 3, 15, 10)));
  assert.deepEqual(slotUnlockDate("2026-01-31T10:00:00Z"), new Date(Date.UTC(2026, 3, 30, 10)));
  assert.deepEqual(slotUnlockDate("2026-11-30T10:00:00Z"), new Date(Date.UTC(2027, 1, 28, 10)));
  // The time of day survives: a leap-day clamp still lands at the same hour.
  assert.deepEqual(slotUnlockDate("2026-12-31T23:30:00Z"), new Date(Date.UTC(2027, 2, 31, 23, 30)));
});
