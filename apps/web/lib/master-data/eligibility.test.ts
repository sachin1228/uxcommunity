import assert from "node:assert/strict"
import test from "node:test"

import { shouldAutoFetchImage } from "./eligibility"

test("real master-data entries are eligible, including Indian cities", () => {
  for (const name of [
    "London",
    "New York City",
    "Mumbai",
    "Delhi",
    "Bengaluru",
    "Hyderabad",
    "Chennai",
    "Pune",
    "Kolkata",
    "Healthcare & MedTech",
    "Finance & Fintech",
    "SaaS & Enterprise Software",
    "UI Design",
    "UX Research",
    "Motion",
    "Junior Designers",
    "Senior Designers",
    "Freelancers",
  ]) {
    assert.equal(shouldAutoFetchImage(name), true, `${name} should be eligible`)
  }
})

test("Other catch-all option is excluded regardless of case", () => {
  assert.equal(shouldAutoFetchImage("Other"), false)
  assert.equal(shouldAutoFetchImage("other"), false)
  assert.equal(shouldAutoFetchImage("  OTHER  "), false)
})

test("matching is case-insensitive and trims whitespace", () => {
  assert.equal(shouldAutoFetchImage("london"), true)
  assert.equal(shouldAutoFetchImage("  London  "), true)
  assert.equal(shouldAutoFetchImage("  other "), false)
})