import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareDmMessages,
  cursorAfter,
  mergeDmMessages,
  newestRealMessage,
  oldestRealMessage,
} from "./messages";
import type { DmMessage } from "./types";

function msg(id: string, created_at: string, extra: Partial<DmMessage> = {}): DmMessage {
  return {
    id,
    content: "x",
    created_at,
    user_id: "u1",
    users: null,
    status: "sent",
    reactions: [],
    reply_to: null,
    image_url: null,
    ...extra,
  };
}

// ─── Ordering ─────────────────────────────────────────────────────────────
//
// One comparator serves the initial fetch, the catch-up loop, realtime merges
// and optimistic sends. The id tiebreak is what keeps a burst of
// same-millisecond messages in the SAME order the server pages them in.

test("orders by created_at, then by id for identical timestamps", () => {
  const t = "2026-06-01T00:00:00Z";
  const rows = [msg("b", t), msg("a", t), msg("c", "2026-06-01T00:00:01Z")];
  rows.sort(compareDmMessages);
  assert.deepEqual(rows.map((m) => m.id), ["a", "b", "c"]);
});

test("is a total order: identical (timestamp, id) compares equal", () => {
  const t = "2026-06-01T00:00:00Z";
  assert.equal(compareDmMessages(msg("a", t), msg("a", t)), 0);
});

// ─── Merging ──────────────────────────────────────────────────────────────

test("merge adds unseen rows and sorts with the shared comparator", () => {
  const t = "2026-06-01T00:00:00Z";
  const current = [msg("b", t)];
  const surviving = mergeDmMessages(current, [msg("a", t), msg("c", t)]);
  assert.deepEqual(surviving.map((m) => m.id), ["a", "b", "c"]);
  assert.notEqual(surviving, current);
});

test("merge keeps the CURRENT copy of an already-seen row", () => {
  const t = "2026-06-01T00:00:00Z";
  const enriched = msg("a", t, { content: "refined client-side" });
  const current = [enriched];
  const merged = mergeDmMessages(current, [msg("a", t)]);
  assert.equal(merged[0].content, "refined client-side");
  // Nothing new: identity is preserved so callers can skip re-renders.
  assert.equal(merged, current);
});

test("merge returns the same array when nothing is new", () => {
  const t = "2026-06-01T00:00:00Z";
  const current = [msg("a", t)];
  assert.equal(mergeDmMessages(current, []), current);
  assert.equal(mergeDmMessages(current, [msg("a", t)]), current);
});

test("merge never drops an optimistic (temp-) row", () => {
  const t = "2026-06-01T00:00:00Z";
  const optimistic = msg("temp-123-1", "2026-06-01T00:00:02Z", { status: "sending" });
  const failed = msg("temp-123-2", "2026-06-01T00:00:01Z", { status: "failed" });
  const merged = mergeDmMessages([optimistic, failed], [msg("a", t)]);
  assert.deepEqual(merged.map((m) => m.id).sort(), ["a", "temp-123-1", "temp-123-2"]);
});

// ─── Cursors ──────────────────────────────────────────────────────────────

test("cursorAfter carries both halves of the ordering key", () => {
  const m = msg("id-1", "2026-06-01T00:00:00Z");
  assert.deepEqual(cursorAfter(m), { ts: "2026-06-01T00:00:00Z", id: "id-1" });
});

test("newest/oldest real ignore optimistic rows", () => {
  const rows = [
    msg("temp-1", "2026-06-01T00:00:00Z"),
    msg("real-1", "2026-06-01T00:00:01Z"),
    msg("real-2", "2026-06-01T00:00:02Z"),
    msg("temp-2", "2026-06-01T00:00:03Z"),
  ];
  assert.equal(newestRealMessage(rows)?.id, "real-2");
  assert.equal(oldestRealMessage(rows)?.id, "real-1");
  assert.equal(newestRealMessage([msg("temp-1", "2026-06-01T00:00:00Z")]), null);
  assert.equal(oldestRealMessage([]), null);
});
