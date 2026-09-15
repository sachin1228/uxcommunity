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

/** Every type the app still generates. */
const ALL_TYPES: NotificationType[] = [
  "thread_like",
  "thread_comment",
  "thread_reply",
  "resource_comment",
  "resource_reply",
  "event_comment",
  "event_reply",
  "event_rsvp",
];

test("every generated notification type lands in the activity tab", () => {
  for (const type of ALL_TYPES) {
    assert.equal(notificationTabFor(type), "activity", type);
  }
});

// The Other tab is a static placeholder: it claims no types yet, so a type it
// is not given stays invisible instead of leaking into the first tab.
test("the Other tab renders nothing until it claims a type", () => {
  const page = splitNotificationsByTab([
    item("n1", "thread_like", "2026-09-15T10:00:00Z"),
    item("n2", "event_rsvp", "2026-09-15T09:00:00Z"),
  ]);

  assert.equal(page.other.length, 0);
  assert.equal(page.unreadByTab.other, 0);
});

test("a type no tab declares stays invisible", () => {
  assert.equal(notificationTabFor("chat_mention" as NotificationType), null);
  assert.equal(notificationTabFor("community_thread" as NotificationType), null);
});

test("splitting keeps order and counts only the unread items it shows", () => {
  const { activity, other, unreadByTab } = splitNotificationsByTab([
    item("n1", "thread_like", "2026-09-15T09:00:00Z", "2026-09-15T09:30:00Z"),
    item("n2", "thread_comment", "2026-09-15T08:00:00Z"),
    item("n3", "event_rsvp", "2026-09-15T07:00:00Z"),
  ]);

  assert.deepEqual(activity.map((n) => n.id), ["n1", "n2", "n3"]);
  assert.deepEqual(other, []);
  assert.deepEqual(unreadByTab, { activity: 2, other: 0 });
});

test("an empty page yields two empty tabs", () => {
  const { activity, other, unreadByTab } = splitNotificationsByTab([]);
  assert.deepEqual(activity, []);
  assert.deepEqual(other, []);
  assert.deepEqual(unreadByTab, { activity: 0, other: 0 });
});
