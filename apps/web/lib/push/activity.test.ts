import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activityFcmData,
  activityIcon,
  activityPushMessages,
  shouldPushActivity,
} from "./activity";

test("types with their own push are not pushed twice", () => {
  for (const type of ["event_reminder", "event_live", "event_ended", "join_request_accepted"]) {
    assert.equal(shouldPushActivity(type), false, type);
  }
  for (const type of ["thread_like", "thread_comment", "job_match", "event_rsvp"]) {
    assert.equal(shouldPushActivity(type), true, type);
  }
});

test("an audible activity push targets the buzzing channel and opens the bell", () => {
  const [message] = activityPushMessages(["ExpoPushToken[one]"], {
    notificationId: "n-1",
    notificationType: "thread_like",
    title: "John liked your thread",
    body: "Hello mumbaikars !",
    href: "/dashboard/notifications",
    audible: true,
    timestamp: 1234,
  });

  assert.equal(message.sound, "default");
  assert.equal(message.channelId, "messages");
  assert.equal(message.collapseId, "app-notification-n-1");
  assert.deepEqual(message.data, {
    type: "app_notification",
    notificationId: "n-1",
    notificationType: "thread_like",
    href: "/dashboard/notifications",
    silent: false,
  });
});

test("a quiet-hours activity push is silent but still lands", () => {
  const [message] = activityPushMessages(["ExpoPushToken[one]"], {
    notificationId: "n-2",
    notificationType: "job_match",
    title: "A new role matches your profile",
    body: "Product Designer at Acme",
    href: "/dashboard/jobs/j-1",
    audible: false,
    timestamp: 1234,
  });

  assert.equal(message.sound, null);
  assert.equal(message.channelId, "messages-silent");
  assert.equal(message.data?.silent, true);
});

test("an activity FCM payload carries the resolved avatar and type glyph", () => {
  const data = activityFcmData({
    notificationId: "n-1",
    notificationType: "thread_like",
    title: "John liked your thread",
    body: "Hello mumbaikars !",
    href: "/dashboard/communities/c-1/threads/t-1",
    imageUrl: "https://media.example/john.webp",
    personName: "John",
    audible: true,
    timestamp: 1234,
  });

  assert.equal(data.type, "app_notification");
  assert.equal(data.direct, "1");
  assert.equal(data.title, "John liked your thread");
  assert.equal(data.body, "Hello mumbaikars !");
  assert.equal(data.imageUrl, "https://media.example/john.webp");
  assert.equal(data.icon, "❤️");
  assert.equal(data.personName, "John");
  assert.equal(data.silent, "0");
  assert.equal(data.timestamp, "1234");
});

test("job matches use the briefcase glyph; unknown types fall back to the bell", () => {
  assert.equal(activityIcon("job_match"), "💼");
  assert.equal(activityIcon("event_comment"), "💬");
  assert.equal(activityIcon("something_new"), "🔔");
});
