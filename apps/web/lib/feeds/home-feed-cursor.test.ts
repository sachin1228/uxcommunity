import assert from "node:assert/strict";
import test from "node:test";

import { homeFeedCursorQuery, parseHomeFeedCursor } from "./home-feed-cursor";

test("a timestamp-only cursor still loads", () => {
  assert.deepEqual(parseHomeFeedCursor("2026-11-06T10:00:00.000Z", null), {
    ok: true,
    before: "2026-11-06T10:00:00.000Z",
    beforeId: null,
  });
});

test("the compound cursor keeps both halves", () => {
  const id = "6f1f5e58-9d6a-4d94-8f2a-1a7a4e2f9b11";
  assert.deepEqual(parseHomeFeedCursor("2026-11-06T10:00:00.000Z", id), {
    ok: true,
    before: "2026-11-06T10:00:00.000Z",
    beforeId: id,
  });
});

test("malformed cursors are rejected instead of reaching the database", () => {
  assert.equal(parseHomeFeedCursor("not-a-date", null).ok, false);
  assert.equal(parseHomeFeedCursor("2026-11-06T10:00:00.000Z", "not-a-uuid").ok, false);
});

test("an id without a timestamp is ignored, matching the SQL predicate", () => {
  assert.deepEqual(parseHomeFeedCursor(null, "6f1f5e58-9d6a-4d94-8f2a-1a7a4e2f9b11"), {
    ok: true,
    before: null,
    beforeId: null,
  });
});

test("load-more URL carries both cursor halves", () => {
  assert.equal(
    homeFeedCursorQuery({ created_at: "2026-11-06T10:00:00.000Z", id: "6f1f5e58-9d6a-4d94-8f2a-1a7a4e2f9b11" }),
    "before=2026-11-06T10%3A00%3A00.000Z&before_id=6f1f5e58-9d6a-4d94-8f2a-1a7a4e2f9b11",
  );
});
