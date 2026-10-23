import assert from "node:assert/strict";
import { test } from "node:test";
import { activityPushMessages, shouldPushActivity } from "./activity";

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
  });

  assert.equal(message.sound, null);
  assert.equal(message.channelId, "messages-silent");
  assert.equal(message.data?.silent, true);
});
