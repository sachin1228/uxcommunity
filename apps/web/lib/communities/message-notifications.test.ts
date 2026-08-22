import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import {
  formatMessageBurstPreview,
  formatMessageNotificationPreview,
  markMessageNotificationSeen,
  shouldShowBrowserNotification,
  type IncomingCommunityMessage,
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

test("summarizes message bursts by message and sender count", () => {
  const message = (id: string, senderId: string, senderName: string): IncomingCommunityMessage => ({
    id,
    communityId: "community-1",
    communityName: "Designers",
    senderId,
    senderName,
    content: "Hello",
    hasImage: false,
    isReply: false,
  });

  assert.equal(
    formatMessageBurstPreview([
      message("1", "user-1", "Ari"),
      message("2", "user-1", "Ari"),
    ]),
    "2 new messages from Ari",
  );
  assert.equal(
    formatMessageBurstPreview([
      message("1", "user-1", "Ari"),
      message("2", "user-2", "Sam"),
      message("3", "user-1", "Ari"),
    ]),
    "3 new messages from 2 people",
  );
});

test("shows browser notifications only when enabled, granted, and attention is away", () => {
  assert.equal(shouldShowBrowserNotification({ sound: true, browser: true }, "granted", true), true);
  assert.equal(shouldShowBrowserNotification({ sound: true, browser: false }, "granted", true), false);
  assert.equal(shouldShowBrowserNotification({ sound: true, browser: true }, "denied", true), false);
  assert.equal(shouldShowBrowserNotification({ sound: true, browser: true }, "granted", false), false);
});

test("deduplicates the same realtime message id", () => {
  const id = `message-${Date.now()}-${Math.random()}`;
  assert.equal(markMessageNotificationSeen(id), true);
  assert.equal(markMessageNotificationSeen(id), false);
});
