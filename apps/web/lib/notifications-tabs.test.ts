import assert from "node:assert/strict";
import { test } from "node:test";
import type { NotificationType } from "./use-notifications";
import { notificationTabFor, splitNotificationsByTab } from "./notifications-tabs";

function item(
  id: string,
  type: NotificationType,
  createdAt: string,
  readAt: string | null = null,
) {
  return {
    id,
    user_id: "u1",
    type,
    title: `title-${id}`,
    body: null,
    href: "/",
    read_at: readAt,
    created_at: createdAt,
  };
}

test("likes, comments and replies land in the activity tab", () => {
  const engagement: NotificationType[] = [
    "thread_like",
    "thread_comment",
    "thread_reply",
    "resource_comment",
    "resource_reply",
    "event_comment",
    "event_reply",
  ];

  for (const type of engagement) {
    assert.equal(notificationTabFor(type), "activity", type);
  }
});

// The request behind the split: created / shared / mentioned notifications must
// not show up in the likes-and-comments list.
test("created, shared and mentioned notifications go to Other", () => {
  for (const type of [
    "community_thread",
    "community_resource",
    "community_event",
    "event_rsvp",
    "event_save",
    "chat_mention",
  ] as NotificationType[]) {
    assert.equal(notificationTabFor(type), "other", type);
  }
});

test("an unrecognised future type defaults to Other", () => {
  assert.equal(notificationTabFor("community_poll" as NotificationType), "other");
});

test("splitting preserves newest-first order and counts unread per tab", () => {
  const { activity, other, unreadByTab } = splitNotificationsByTab([
    item("n1", "community_thread", "2026-09-15T10:00:00Z"),
    item("n2", "thread_like", "2026-09-15T09:00:00Z", "2026-09-15T09:30:00Z"),
    item("n3", "chat_mention", "2026-09-15T08:00:00Z"),
    item("n4", "thread_comment", "2026-09-15T07:00:00Z"),
  ]);

  assert.deepEqual(activity.map((n) => n.id), ["n2", "n4"]);
  assert.deepEqual(other.map((n) => n.id), ["n1", "n3"]);
  assert.deepEqual(unreadByTab, { activity: 1, other: 2 });
});

test("an empty page yields two empty tabs", () => {
  const { activity, other, unreadByTab } = splitNotificationsByTab([]);
  assert.deepEqual(activity, []);
  assert.deepEqual(other, []);
  assert.deepEqual(unreadByTab, { activity: 0, other: 0 });
});
