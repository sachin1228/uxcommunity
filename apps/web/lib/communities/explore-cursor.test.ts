/**
 * The Explore page contract: the cursor that pages the directory, and what a
 * page does to the list already loaded.
 *
 * No database and no browser — the SQL side has its own walker
 * (supabase/tests/all_communities_cursor.test.sql), and these cases are the ones
 * that are decided in TypeScript: a malformed cursor must be refused rather than
 * mistaken for "first page", and a page must never duplicate a card.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EXPLORE_PAGE_SIZE,
  formatExploreCursor,
  mergeExploreRows,
  parseExploreCursor,
} from "./explore-cursor";
import type { CachedExploreCommunity } from "./cache/types";

const COMMUNITY = "11111111-1111-4111-8111-111111111111";

function row(id: string, name: string): CachedExploreCommunity {
  return {
    id,
    name,
    type: "user",
    image_url: null,
    description: null,
    member_count: 1,
    joined: false,
    can_join: true,
  };
}

test("a page is a page: the size is a positive whole number of cards", () => {
  assert.ok(EXPLORE_PAGE_SIZE > 0);
  assert.equal(EXPLORE_PAGE_SIZE % 3, 0, "three cards to a row");
});

test("no cursor at all is the first page, not an error", () => {
  for (const raw of [null, undefined, ""]) {
    assert.deepEqual(parseExploreCursor(raw), { cursor: null, valid: true });
  }
});

test("a cursor survives the round trip it was written for", () => {
  const written = formatExploreCursor({ name: "Design System", id: COMMUNITY });
  assert.deepEqual(parseExploreCursor(written), {
    cursor: { name: "Design System", id: COMMUNITY },
    valid: true,
  });
});

test("a name containing the separator still parses — the id half is the UUID", () => {
  const written = formatExploreCursor({ name: "A | B", id: COMMUNITY });
  assert.deepEqual(parseExploreCursor(written), {
    cursor: { name: "A | B", id: COMMUNITY },
    valid: true,
  });
});

test("a malformed cursor is refused rather than treated as the first page", () => {
  const malformed = [
    "|" + COMMUNITY, // no name: `name >= ''` would repeat the boundary row
    "Design System|", // no id
    "Design System", // one half only
    "Design System|not-a-uuid",
    "Design System|11111111-1111-4111-8111-11111111111", // one digit short
  ];

  for (const raw of malformed) {
    assert.deepEqual(
      parseExploreCursor(raw),
      { cursor: null, valid: false },
      `expected ${JSON.stringify(raw)} to be refused`,
    );
  }
});

test("appending a page keeps the order and never repeats a card", () => {
  const loaded = [row("a", "A"), row("b", "B")];
  const page = [row("b", "B"), row("c", "C")];

  assert.deepEqual(
    mergeExploreRows(loaded, page).map((c) => c.id),
    ["a", "b", "c"],
  );
});

test("a page with nothing new leaves the list as it was", () => {
  const loaded = [row("a", "A")];
  const merged = mergeExploreRows(loaded, [row("a", "A")]);

  assert.deepEqual(merged.map((c) => c.id), ["a"]);
});

test("an empty page does not disturb the list", () => {
  const loaded = [row("a", "A")];
  assert.deepEqual(mergeExploreRows(loaded, []).map((c) => c.id), ["a"]);
});
