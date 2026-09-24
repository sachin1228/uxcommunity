import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVENT_CHAT_NAME_MAX,
  canJoinEventChatWith,
  eventChatName,
} from "./event-chat-rules";

// The room is named after the event, inside the same 80-character bound the
// Create Community form enforces — a longer event title must not produce a
// community row the rest of the app refuses to create.
test("the room name is the event title, capped at the community limit", () => {
  assert.equal(eventChatName("DesignUp decade"), "DesignUp decade");

  const longTitle = "D".repeat(200);
  const name = eventChatName(longTitle);
  assert.equal(name.length, EVENT_CHAT_NAME_MAX);
  assert.equal(name, longTitle.slice(0, EVENT_CHAT_NAME_MAX));
});

test("the room name is trimmed, and a blank title still names the room", () => {
  assert.equal(eventChatName("  DesignUp decade  "), "DesignUp decade");
  assert.equal(eventChatName(""), "Event chat");
  assert.equal(eventChatName("   "), "Event chat");
});

// The door into the room: public events are open to anybody who can see them,
// while a community-scoped event is for that community's members alone.
test("a public event's chat is open to everyone", () => {
  assert.equal(canJoinEventChatWith(true, false), true);
  assert.equal(canJoinEventChatWith(true, true), true);
});

test("a private event's chat is for its community's members", () => {
  assert.equal(canJoinEventChatWith(false, true), true);
  assert.equal(canJoinEventChatWith(false, false), false);
});
