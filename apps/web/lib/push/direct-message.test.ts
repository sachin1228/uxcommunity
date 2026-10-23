import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarBackground, nameInitials } from "@/lib/avatar";
import {
  directMessageFcmData,
  directMessagePushMessages,
  directMessagePushPlan,
  type DirectMessagePreferences,
} from "./direct-message";

const NOW = new Date("2026-10-23T20:00:00Z");

function preferences(overrides: Partial<DirectMessagePreferences> = {}): DirectMessagePreferences {
  return {
    chat_push_enabled: true,
    chat_sound: "default",
    quiet_hours_enabled: false,
    quiet_hours_start: "22:00",
    quiet_hours_end: "07:00",
    quiet_hours_timezone: "UTC",
    ...overrides,
  };
}

test("no row means chat pushes are on and audible", () => {
  assert.deepEqual(directMessagePushPlan(undefined, NOW), { send: true, audible: true });
});

test("the chat master switch turns DM pushes off completely", () => {
  assert.deepEqual(
    directMessagePushPlan(preferences({ chat_push_enabled: false }), NOW),
    { send: false, audible: false },
  );
});

test("quiet hours and the silent choice keep the push but drop the buzz", () => {
  assert.deepEqual(
    directMessagePushPlan(
      preferences({
        quiet_hours_enabled: true,
        quiet_hours_start: "19:00",
        quiet_hours_end: "07:00",
      }),
      NOW,
    ),
    { send: true, audible: false },
  );
  assert.deepEqual(
    directMessagePushPlan(preferences({ chat_sound: "silent" }), NOW),
    { send: true, audible: false },
  );
});

test("a DM push wears the sender, the preview and a per-conversation collapse id", () => {
  const [message] = directMessagePushMessages(["ExpoPushToken[one]"], {
    conversationId: "dm-1",
    messageId: "m-1",
    senderId: "u-2",
    senderName: "John",
    senderAvatarUrl: "https://media.example/john.webp",
    content: "Hi there",
    hasImage: false,
    isReply: false,
    audible: true,
  });

  assert.equal(message.title, "John");
  assert.equal(message.body, "Hi there");
  assert.equal(message.channelId, "messages");
  assert.equal(message.sound, "default");
  assert.equal(message.collapseId, "dm-dm-1");
  assert.deepEqual(message.data, {
    type: "dm_message",
    conversationId: "dm-1",
    messageId: "m-1",
    senderId: "u-2",
    senderName: "John",
    senderAvatarUrl: "https://media.example/john.webp",
    silent: false,
  });
});

test("an image-only DM previews as a photo", () => {
  const [message] = directMessagePushMessages(["ExpoPushToken[one]"], {
    conversationId: "dm-1",
    messageId: "m-2",
    senderId: "u-2",
    senderName: null,
    senderAvatarUrl: null,
    content: "",
    hasImage: true,
    isReply: false,
    audible: false,
  });

  assert.equal(message.title, "New message");
  assert.equal(message.body, "Sent a photo");
  assert.equal(message.channelId, "messages-silent");
});

test("the direct-FCM DM payload carries the sender photo and conversation", () => {
  const data = directMessageFcmData({
    conversationId: "dm-1",
    messageId: "m-1",
    senderId: "u-2",
    senderName: "John",
    senderAvatarUrl: "https://media.example/john.webp",
    content: "Hi there",
    hasImage: false,
    isReply: false,
    audible: true,
    timestamp: 1234,
  });

  assert.equal(data.type, "dm_message");
  assert.equal(data.direct, "1");
  assert.equal(data.conversationId, "dm-1");
  assert.equal(data.senderId, "u-2");
  assert.equal(data.title, "John");
  assert.equal(data.message, "Hi there");
  assert.equal(data.imageUrl, "https://media.example/john.webp");
  assert.equal(data.silent, "0");
  assert.equal(data.timestamp, "1234");
});

test("a DM without a photo uses the app's exact initials and palette color", () => {
  const data = directMessageFcmData({
    conversationId: "dm-1",
    messageId: "m-1",
    senderId: "u-2",
    senderName: "sundar pichai",
    senderAvatarUrl: null,
    content: "hi man",
    hasImage: false,
    isReply: false,
    audible: true,
    timestamp: 1234,
  });

  assert.equal(data.avatarInitials, "SP");
  assert.equal(data.avatarColor, avatarBackground("sundar pichai"));
  assert.equal(data.avatarInitials, nameInitials("sundar pichai"));
});
