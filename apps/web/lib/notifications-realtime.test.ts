/**
 * M-4 — the realtime half of notification deduplication.
 *
 * create_notification() reports whether it INSERTED a row or aggregated a
 * repeat event into the existing unread one. The client (`use-notifications.ts`)
 * handles the two topics differently: an `insert` prepends a row and increments
 * the unread badge, an `update` patches a row it already has. Publishing the
 * wrong topic for a deduplicated event would show the notification twice and
 * count the badge twice, so the mapping from the RPC's `inserted` flag to the
 * event topic is pinned here.
 *
 * These tests exercise the pure shaping helper only (no server-only imports),
 * which is why they can run in the plain Node test runner.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  notificationRealtimeEvent,
  type NotificationCreatedRow,
} from "./notifications-realtime";

function row(overrides: Partial<NotificationCreatedRow> = {}): NotificationCreatedRow {
  return {
    id: "n-1",
    user_id: "u-recipient",
    actor_id: "u-actor",
    community_id: "c-1",
    type: "thread_like",
    entity_type: "thread",
    entity_id: "t-1",
    title: "Alice liked your thread",
    body: "Thread title",
    href: "/dashboard/communities/c-1/threads/t-1",
    metadata: { count: 2 },
    read_at: null,
    created_at: "2026-09-28T10:00:00.000Z",
    inserted: false,
    ...overrides,
  };
}

test("an inserted notification publishes the flat insert payload", () => {
  const event = notificationRealtimeEvent(row({ inserted: true }), "notifications:u-recipient");

  assert.equal(event.topic, "insert");
  assert.equal(event.room, "notifications:u-recipient");
  // Exactly the fields the client's insert handler destructures — no more.
  assert.deepEqual(event.data, {
    id: "n-1",
    user_id: "u-recipient",
    type: "thread_like",
    title: "Alice liked your thread",
    body: "Thread title",
    href: "/dashboard/communities/c-1/threads/t-1",
    read_at: null,
    created_at: "2026-09-28T10:00:00.000Z",
  });
});

test("a deduplicated event publishes an update, never a second insert", () => {
  const event = notificationRealtimeEvent(row({ inserted: false }), "notifications:u-recipient");

  assert.equal(event.topic, "update", "a conflict must not be published as a new notification");
  assert.deepEqual(event.data, {
    next: {
      id: "n-1",
      user_id: "u-recipient",
      actor_id: "u-actor",
      community_id: "c-1",
      type: "thread_like",
      entity_type: "thread",
      entity_id: "t-1",
      title: "Alice liked your thread",
      body: "Thread title",
      href: "/dashboard/communities/c-1/threads/t-1",
      read_at: null,
      created_at: "2026-09-28T10:00:00.000Z",
    },
    // The client decrements the unread badge only when old was unread; an
    // aggregated row is always unread.
    old: { id: "n-1", read_at: null },
  });
});

test("the topic follows the inserted flag, not the caller", () => {
  assert.equal(
    notificationRealtimeEvent(row({ inserted: true }), "r").topic,
    "insert",
  );
  assert.equal(
    notificationRealtimeEvent(row({ inserted: false }), "r").topic,
    "update",
  );
});
