import assert from "node:assert/strict"
import test from "node:test"

import {
  PAGE_DESTINATIONS,
  SEARCH_RESULT_LIMIT,
  communityDestination,
  isApplePlatform,
  searchDestinations,
  type SearchableCommunity,
} from "./topbar"

const COMMUNITIES: SearchableCommunity[] = [
  { id: "c1", name: "Design", reference_name: "Product design" },
  { id: "c2", name: "Pune Designers", reference_name: "Pune" },
  { id: "c3", name: "Archived Room", is_archived: true },
]

// ─── Search ranking ──────────────────────────────────────────────────────────

test("an empty query lists the pages first", () => {
  const results = searchDestinations("", COMMUNITIES)
  assert.deepEqual(
    results.slice(0, PAGE_DESTINATIONS.length).map((row) => row.id),
    PAGE_DESTINATIONS.map((row) => row.id),
  )
})

test("an empty query respects the row limit", () => {
  const many: SearchableCommunity[] = Array.from({ length: 40 }, (_, i) => ({
    id: `c${i}`,
    name: `Room ${i}`,
  }))
  assert.equal(searchDestinations("", many).length, SEARCH_RESULT_LIMIT)
})

test("matching ignores case and surrounding space", () => {
  const results = searchDestinations("  LIBRARY ", COMMUNITIES)
  assert.equal(results[0]?.href, "/dashboard/library")
})

test("a label prefix outranks a label substring", () => {
  const hits = searchDestinations("lib", [
    { id: "x", name: "Deliberate Studio" },
    { id: "y", name: "Library Club" },
  ])
  assert.equal(hits[0]?.label, "Library")
  assert.equal(hits[1]?.label, "Library Club")
})

test("keywords make a page findable by a word that is not in its label", () => {
  assert.equal(searchDestinations("bookmarks", [])[0]?.href, "/dashboard/library")
})

test("a community's parent value is searchable", () => {
  const hits = searchDestinations("pune", COMMUNITIES)
  assert.equal(hits.length, 1)
  assert.equal(hits[0]?.href, "/dashboard/communities/c2")
})

test("archived communities are never offered", () => {
  assert.deepEqual(searchDestinations("Archived Room", COMMUNITIES), [])
})

test("pages sort above communities even when both match equally well", () => {
  // "job" prefix-matches the Jobs page and the community's own name, so only
  // the group order can separate them — the palette's order stays stable
  // instead of being a pure score race.
  const hits = searchDestinations("job", [{ id: "c9", name: "Job Seekers" }])
  assert.deepEqual(hits.map((row) => row.group), ["page", "community"])
})

test("a query that matches nothing yields no rows", () => {
  assert.deepEqual(searchDestinations("zzzzz", COMMUNITIES), [])
})

test("the row limit applies to a query too", () => {
  const many: SearchableCommunity[] = Array.from({ length: 40 }, (_, i) => ({
    id: `c${i}`,
    name: `Designers ${i}`,
  }))
  assert.equal(searchDestinations("designers", many).length, SEARCH_RESULT_LIMIT)
})

test("every destination carries a unique id and an absolute href", () => {
  const rows = searchDestinations("", COMMUNITIES)
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length)
  for (const row of rows) {
    assert.match(row.href, /^\/dashboard/)
  }
})

test("community destinations key off the community id", () => {
  assert.equal(communityDestination({ id: "abc", name: "X" }).id, "community:abc")
})

// ─── Platform hint ───────────────────────────────────────────────────────────

test("the command glyph is only claimed on Apple platforms", () => {
  assert.equal(isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), true)
  assert.equal(isApplePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false)
  assert.equal(isApplePlatform("Mozilla/5.0 (Linux; Android 14)"), false)
})
