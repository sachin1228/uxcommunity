import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
    senderName: "John",
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
    silent: false,
  });
});

test("an image-only DM previews as a photo", () => {
  const [message] = directMessagePushMessages(["ExpoPushToken[one]"], {
    conversationId: "dm-1",
    messageId: "m-2",
    senderName: null,
    content: "",
    hasImage: true,
    isReply: false,
    audible: false,
  });

  assert.equal(message.title, "New message");
  assert.equal(message.body, "Sent a photo");
  assert.equal(message.channelId, "messages-silent");
});
