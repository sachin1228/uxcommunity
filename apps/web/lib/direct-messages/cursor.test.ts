import assert from "node:assert/strict";
import { test } from "node:test";
import { dmCursorQuery, normalizeUtcCursor, toUtcCursor } from "./cursor";

// ─── Compound page cursors ────────────────────────────────────────────────
//
// Both halves of (created_at, id) travel together: the timestamp alone names
// a millisecond that can hold several messages, and a timestamp-only cursor
// is exactly what let a same-millisecond burst straddle a page boundary.

test("a before cursor serializes both halves", () => {
  const query = dmCursorQuery({
    before: { ts: "2026-06-01T00:00:00+00:00", id: "abc-123" },
  });
  const params = new URLSearchParams(query);
  assert.equal(params.get("before"), "2026-06-01T00:00:00Z");
  assert.equal(params.get("before_id"), "abc-123");
});

test("an after cursor serializes both halves", () => {
  const query = dmCursorQuery({
    after: { ts: "2026-06-01T00:00:00.500Z", id: "abc-123" },
  });
  const params = new URLSearchParams(query);
  assert.equal(params.get("after"), "2026-06-01T00:00:00.500Z");
  assert.equal(params.get("after_id"), "abc-123");
});

test("no cursors yields an empty query string", () => {
  assert.equal(dmCursorQuery({}), "");
  assert.equal(dmCursorQuery({ before: null, after: null }), "");
});

test("the PostgREST +00:00 form never reaches the wire un-normalized", () => {
  // The '+'-to-space mangling in the Cloudflare runtime is why cursors
  // travel as Z; toUtcCursor is the serializer that guarantees it.
  assert.equal(toUtcCursor("2026-06-01T00:00:00+00:00"), "2026-06-01T00:00:00Z");
  const query = dmCursorQuery({ after: { ts: toUtcCursor("2026-06-01T00:00:00+00:00"), id: "x" } });
  assert.ok(!query.includes("+") && !query.includes("%20"));
  assert.equal(new URLSearchParams(query).get("after"), "2026-06-01T00:00:00Z");
});

// ─── Timestamp normalization (existing contract) ──────────────────────────

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
