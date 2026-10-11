import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceSeenAt,
  countUnseenSince,
  newestCreatedAt,
  readSeenAt,
  seenStorageKey,
} from "./notifications-seen";

function item(createdAt: string, readAt: string | null = null) {
  return { created_at: createdAt, read_at: readAt };
}

test("countUnseenSince counts only unread items newer than the watermark", () => {
  const seenAt = "2026-10-11T10:00:00.000Z";
  const notifications = [
    item("2026-10-11T11:00:00.000Z"), // unread, newer — counts
    item("2026-10-11T10:30:00.000Z", "2026-10-11T10:45:00.000Z"), // newer but read
    item("2026-10-11T09:00:00.000Z"), // unread but older
    item("2026-10-11T10:00:00.000Z"), // exactly at the watermark — already seen
  ];

  assert.equal(countUnseenSince(notifications, seenAt), 1);
});

test("nothing unseen on an empty list or an all-read page", () => {
  const seenAt = "2026-10-11T10:00:00.000Z";
  assert.equal(countUnseenSince([], seenAt), 0);
  assert.equal(
    countUnseenSince(
      [item("2026-10-11T11:00:00.000Z", "2026-10-11T11:05:00.000Z")],
      seenAt,
    ),
    0,
  );
});

// The watermark comes from notification timestamps, never the device clock,
// and Postgres trims trailing zeros in fractional seconds — comparisons must
// not rely on fixed-width strings.
test("newestCreatedAt finds the maximum even out of order or oddly formatted", () => {
  assert.equal(
    newestCreatedAt([
      { created_at: "2026-10-11T09:00:00+00:00" },
      { created_at: "2026-10-11T10:30:00.5+00:00" },
      { created_at: "2026-10-11T10:30:00+00:00" },
    ]),
    "2026-10-11T10:30:00.5+00:00",
  );
  assert.equal(newestCreatedAt([]), null);
});

test("the watermark advances but never moves backwards", () => {
  const userId = "seen-test-user";
  assert.equal(readSeenAt(userId), null);

  assert.equal(advanceSeenAt(userId, "2026-10-11T10:00:00.000Z"), true);
  assert.equal(readSeenAt(userId), "2026-10-11T10:00:00.000Z");

  // A stale list (or a second tab) offering an older timestamp changes nothing.
  assert.equal(advanceSeenAt(userId, "2026-10-11T09:00:00.000Z"), false);
  assert.equal(advanceSeenAt(userId, "2026-10-11T10:00:00.000Z"), false);
  assert.equal(readSeenAt(userId), "2026-10-11T10:00:00.000Z");

  // Cross-format comparison: a Z-suffixed watermark still orders correctly.
  assert.equal(advanceSeenAt(userId, "2026-10-11T11:00:00+00:00"), true);
  assert.equal(readSeenAt(userId), "2026-10-11T11:00:00+00:00");
});

test("watermarks are namespaced per user", () => {
  assert.equal(seenStorageKey("u1"), "uxcommunity:notifications:seen:u1");
  assert.notEqual(seenStorageKey("u1"), seenStorageKey("u2"));

  const a = "seen-test-user-a";
  const b = "seen-test-user-b";
  advanceSeenAt(a, "2026-10-11T10:00:00.000Z");
  assert.equal(readSeenAt(b), null);
});
