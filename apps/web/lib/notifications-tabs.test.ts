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
  "thread_deleted",
  "showcase_deleted",
  "resource_deleted",
  "event_deleted",
  "report_reviewed",
  "content_restored",
  "job_match",
  "join_request_accepted",
  "event_reminder",
  "event_live",
  "event_ended",
];

test("every generated notification type lands in a tab", () => {
  for (const type of ALL_TYPES) {
    assert.notEqual(notificationTabFor(type), null, type);
  }
});

test("likes on threads render under the Likes tab", () => {
  assert.equal(notificationTabFor("thread_like"), "likes");
});

test("comments and replies on threads/resources render under the Comments tab", () => {
  for (const type of [
    "thread_comment",
    "thread_reply",
    "resource_comment",
    "resource_reply",
  ] as NotificationType[]) {
    assert.equal(notificationTabFor(type), "comments", type);
  }
});

test("all event types render under the events tab", () => {
  for (const type of [
    "event_comment",
    "event_reply",
    "event_rsvp",
    "event_reminder",
    "event_live",
    "event_ended",
  ] as NotificationType[]) {
    assert.equal(notificationTabFor(type), "events", type);
  }
});

test("job matches render under the Jobs tab", () => {
  assert.equal(notificationTabFor("job_match"), "jobs");

  const page = splitNotificationsByTab([
    item("n1", "job_match", "2026-10-10T11:00:00Z"),
    item("n2", "thread_like", "2026-09-15T09:00:00Z"),
    item("n3", "job_match", "2026-10-10T08:00:00Z", "2026-10-10T08:30:00Z"),
  ]);

  assert.deepEqual(page.jobs.map((n) => n.id), ["n1", "n3"]);
  assert.equal(page.unreadByTab.jobs, 1);
});

// The Other tab renders manager/platform removals of the user's content, the
// reporter's thank-you and the accepted join requests; a type it is not given
// stays invisible instead of leaking into another tab.
test("content-removal and join-request notices render under the Other tab", () => {
  for (const type of [
    "thread_deleted",
    "showcase_deleted",
    "resource_deleted",
    "event_deleted",
    "report_reviewed",
    "content_restored",
    "join_request_accepted",
  ] as NotificationType[]) {
    assert.equal(notificationTabFor(type), "other", type);
  }

  const page = splitNotificationsByTab([
    item("n1", "thread_deleted", "2026-09-15T10:00:00Z"),
    item("n2", "thread_like", "2026-09-15T09:00:00Z"),
    item("n3", "resource_deleted", "2026-09-15T08:00:00Z", "2026-09-15T08:30:00Z"),
    item("n4", "join_request_accepted", "2026-09-15T07:00:00Z"),
  ]);

  assert.deepEqual(page.other.map((n) => n.id), ["n1", "n3", "n4"]);
  assert.equal(page.unreadByTab.other, 2);
});

test("a type no tab declares stays invisible", () => {
  assert.equal(notificationTabFor("chat_mention" as NotificationType), null);
  assert.equal(notificationTabFor("community_thread" as NotificationType), null);
});

test("splitting keeps order and counts only the unread items it shows", () => {
  const { likes, comments, events, other, unreadByTab } = splitNotificationsByTab([
    item("n1", "thread_like", "2026-09-15T09:00:00Z", "2026-09-15T09:30:00Z"),
    item("n2", "event_rsvp", "2026-09-15T08:00:00Z"),
    item("n3", "event_comment", "2026-09-15T07:00:00Z"),
    item("n4", "thread_comment", "2026-09-15T06:00:00Z"),
  ]);

  assert.deepEqual(likes.map((n) => n.id), ["n1"]);
  assert.deepEqual(comments.map((n) => n.id), ["n4"]);
  assert.deepEqual(events.map((n) => n.id), ["n2", "n3"]);
  assert.deepEqual(other, []);
  assert.deepEqual(unreadByTab, { likes: 0, comments: 1, events: 2, jobs: 0, other: 0 });
});

test("likes and comments are split into separate tabs", () => {
  const page = splitNotificationsByTab([
    item("n1", "thread_like", "2026-09-15T09:00:00Z"),
    item("n2", "thread_comment", "2026-09-15T08:00:00Z"),
    item("n3", "resource_reply", "2026-09-15T07:00:00Z"),
    item("n4", "thread_like", "2026-09-15T06:00:00Z", "2026-09-15T06:30:00Z"),
  ]);

  assert.deepEqual(page.likes.map((n) => n.id), ["n1", "n4"]);
  assert.deepEqual(page.comments.map((n) => n.id), ["n2", "n3"]);
  assert.equal(page.unreadByTab.likes, 1);
  assert.equal(page.unreadByTab.comments, 2);
});

test("an empty page yields five empty tabs", () => {
  const { likes, comments, events, jobs, other, unreadByTab } = splitNotificationsByTab([]);
  assert.deepEqual(likes, []);
  assert.deepEqual(comments, []);
  assert.deepEqual(events, []);
  assert.deepEqual(jobs, []);
  assert.deepEqual(other, []);
  assert.deepEqual(unreadByTab, { likes: 0, comments: 0, events: 0, jobs: 0, other: 0 });
});
