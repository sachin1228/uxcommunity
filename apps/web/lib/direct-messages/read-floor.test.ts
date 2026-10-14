import assert from "node:assert/strict";
import { test } from "node:test";
import { applyReadFloor } from "./client-cache";
import { getReadFloor, recordReadFloor } from "./read-manager";
import type { DmConversationSummary } from "./types";

function conversation(extra: Partial<DmConversationSummary> = {}): DmConversationSummary {
  return {
    id: "c1",
    peer: { id: "u2", name: "Peer", avatar_url: null },
    last_message: null,
    unread_count: 0,
    my_last_read_at: null,
    last_message_at: null,
    request_state: "accepted",
    requested_by: null,
    blocked_by_me: false,
    ...extra,
  };
}

// ─── applyReadFloor ───────────────────────────────────────────────────────
//
// A list response produced before a read PATCH landed still reports the old
// unread count. These cases are the ones that made the badge stick: the row
// must keep its cleared state when nothing new can be unread, and must NOT
// hide messages that arrived after the read.

test("clears a stale payload whose newest message was already read", () => {
  const result = applyReadFloor(
    conversation({
      unread_count: 4,
      my_last_read_at: "2026-10-12T12:20:00.000Z",
      last_message_at: "2026-10-12T12:26:00.000Z",
    }),
    "2026-10-12T12:26:00.000Z",
  );
  assert.equal(result.unread_count, 0);
  assert.equal(result.my_last_read_at, "2026-10-12T12:26:00.000Z");
});

test("keeps a marker that is already at or ahead of the floor", () => {
  const result = applyReadFloor(
    conversation({
      unread_count: 3,
      my_last_read_at: "2026-10-12T12:30:00.000Z",
      last_message_at: "2026-10-12T12:26:00.000Z",
    }),
    "2026-10-12T12:26:00.000Z",
  );
  assert.equal(result.unread_count, 0);
  assert.equal(result.my_last_read_at, "2026-10-12T12:30:00.000Z");
});

test("never hides messages newer than the read floor", () => {
  const fresh = conversation({
    unread_count: 2,
    my_last_read_at: "2026-10-12T12:26:00.000Z",
    last_message_at: "2026-10-12T12:40:00.000Z",
  });
  assert.equal(applyReadFloor(fresh, "2026-10-12T12:26:00.000Z"), fresh);
});

test("leaves a conversation alone without a floor or a last message", () => {
  const noFloor = conversation({ unread_count: 4, last_message_at: "2026-10-12T12:26:00.000Z" });
  assert.equal(applyReadFloor(noFloor, null), noFloor);

  const noMessage = conversation({ unread_count: 4, last_message_at: null });
  assert.equal(applyReadFloor(noMessage, "2026-10-12T12:26:00.000Z"), noMessage);
});

test("returns the same object when the row is already cleared (memoization)", () => {
  const cleared = conversation({
    unread_count: 0,
    my_last_read_at: "2026-10-12T12:26:00.000Z",
    last_message_at: "2026-10-12T12:26:00.000Z",
  });
  assert.equal(applyReadFloor(cleared, "2026-10-12T12:26:00.000Z"), cleared);
});

// ─── read floor bookkeeping ───────────────────────────────────────────────

test("the recorded read floor only ever moves forward", () => {
  const id = "floor-monotonic";
  recordReadFloor(id, "2026-10-12T12:30:00.000Z");
  recordReadFloor(id, "2026-10-12T12:10:00.000Z");
  assert.equal(getReadFloor(id), "2026-10-12T12:30:00.000Z");
});

test("an unknown conversation has no read floor", () => {
  assert.equal(getReadFloor("floor-unknown"), null);
});
