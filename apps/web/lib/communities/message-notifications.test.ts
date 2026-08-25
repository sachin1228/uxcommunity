import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import {
  DEFAULT_MESSAGE_NOTIFICATION_PREFERENCES,
  ensureBrowserNotificationPermission,
  formatMessageNotificationPreview,
  markMessageNotificationSeen,
  shouldShowBrowserNotification,
} from "./message-notifications.ts";

test("formats text and media message previews", () => {
  assert.equal(
    formatMessageNotificationPreview({ content: "  Hello   community  ", hasImage: false, isReply: false }),
    "Hello community",
  );
  assert.equal(
    formatMessageNotificationPreview({ content: "", hasImage: true, isReply: false }),
    "Sent a photo",
  );
  assert.equal(
    formatMessageNotificationPreview({ content: "", hasImage: false, isReply: true }),
    "Replied to a message",
  );
  assert.equal(
    formatMessageNotificationPreview({ content: "a".repeat(130), hasImage: false, isReply: false }).length,
    118,
  );
});

test("defaults background browser notifications on and message sounds off", () => {
  assert.deepEqual(DEFAULT_MESSAGE_NOTIFICATION_PREFERENCES, {
    sound: false,
    browser: true,
  });
});

test("shows browser notifications only when enabled, granted, and attention is away", () => {
  assert.equal(shouldShowBrowserNotification({ sound: true, browser: true }, "granted", true), true);
  assert.equal(shouldShowBrowserNotification({ sound: true, browser: false }, "granted", true), false);
  assert.equal(shouldShowBrowserNotification({ sound: true, browser: true }, "denied", true), false);
  assert.equal(shouldShowBrowserNotification({ sound: true, browser: true }, "granted", false), false);
});

test("requests notification permission only while the browser is promptable", async () => {
  let requests = 0;
  const requestPermission = async () => {
    requests += 1;
    return "granted" as const;
  };

  assert.equal(await ensureBrowserNotificationPermission("default", requestPermission), "granted");
  assert.equal(await ensureBrowserNotificationPermission("granted", requestPermission), "granted");
  assert.equal(await ensureBrowserNotificationPermission("denied", requestPermission), "denied");
  assert.equal(await ensureBrowserNotificationPermission("unsupported", requestPermission), "unsupported");
  assert.equal(requests, 1);
});

test("deduplicates the same realtime message id", () => {
  const id = `message-${Date.now()}-${Math.random()}`;
  assert.equal(markMessageNotificationSeen(id), true);
  assert.equal(markMessageNotificationSeen(id), false);
});
