import assert from "node:assert/strict";
import { test } from "node:test";
import {
  communityMessagePageSearch,
  normalizeUtcCursor,
  toUtcCursor,
} from "./message-cursor";

// ─── Compound page cursors ────────────────────────────────────────────────
//
// Both halves of (created_at, id) travel together: the timestamp alone names a
// millisecond that can hold several messages, and a timestamp-only cursor is
// exactly what let a same-timestamp burst straddle a page boundary and lose a
// row (20261013100000_community_message_compound_cursor.sql).

test("a before cursor serializes both halves", () => {
  const params = new URLSearchParams(
    communityMessagePageSearch({ before: { ts: "2026-06-01T00:00:00+00:00", id: "abc-123" } }),
  );
  assert.equal(params.get("before"), "2026-06-01T00:00:00Z");
  assert.equal(params.get("before_id"), "abc-123");
});

test("an after cursor serializes both halves", () => {
  const params = new URLSearchParams(
    communityMessagePageSearch({ after: { ts: "2026-06-01T00:00:00.500Z", id: "abc-123" } }),
  );
  assert.equal(params.get("after"), "2026-06-01T00:00:00.500Z");
  assert.equal(params.get("after_id"), "abc-123");
});

test("no cursor yields an empty search string", () => {
  assert.equal(communityMessagePageSearch({}), "");
  assert.equal(communityMessagePageSearch({ before: null, after: null }), "");
});

test("the chat's own reads opt into the content-reaction groups", () => {
  assert.equal(communityMessagePageSearch({}, { contentReactions: true }), "?withContentReactions=1");
  const params = new URLSearchParams(
    communityMessagePageSearch(
      { after: { ts: "2026-06-01T00:00:00Z", id: "m1" } },
      { contentReactions: true },
    ),
  );
  assert.equal(params.get("withContentReactions"), "1");
  assert.equal(params.get("after_id"), "m1");
});

test("the PostgREST +00:00 form never reaches the wire un-normalized", () => {
  // The '+'-to-space mangling in the Cloudflare runtime is why cursors travel
  // as Z; toUtcCursor is the serializer that guarantees it.
  assert.equal(toUtcCursor("2026-06-01T00:00:00+00:00"), "2026-06-01T00:00:00Z");
  const query = communityMessagePageSearch({
    before: { ts: toUtcCursor("2026-06-01T00:00:00+00:00"), id: "x" },
  });
  assert.ok(!query.includes("+") && !query.includes("%20"));
  assert.equal(new URLSearchParams(query).get("before"), "2026-06-01T00:00:00Z");
});

// ─── Timestamp normalization (shared contract with the DM cursor) ──────────

test("normalizeUtcCursor accepts Z, +00:00 and space-mangled forms", () => {
  assert.equal(normalizeUtcCursor("2026-06-01T00:00:00Z"), "2026-06-01T00:00:00Z");
  assert.equal(normalizeUtcCursor("2026-06-01T00:00:00+00:00"), "2026-06-01T00:00:00Z");
  assert.equal(normalizeUtcCursor("2026-06-01T00:00:00 00:00"), "2026-06-01T00:00:00Z");
  assert.equal(normalizeUtcCursor("2026-06-01T00:00:00.25Z"), "2026-06-01T00:00:00.25Z");
});

test("normalizeUtcCursor rejects malformed input", () => {
  assert.equal(normalizeUtcCursor("yesterday"), null);
  assert.equal(normalizeUtcCursor("2026-06-01"), null);
  assert.equal(normalizeUtcCursor(""), null);
  assert.equal(normalizeUtcCursor(null), null);
  assert.equal(normalizeUtcCursor(undefined), null);
});
