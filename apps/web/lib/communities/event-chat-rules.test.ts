import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVENT_CHAT_DESCRIPTION,
  EVENT_CHAT_NAME_MAX,
  canJoinEventChatWith,
  eventChatName,
  roomStillOnlyChat,
  roomStillWearsEvent,
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

// The clothes the owner's offer to keep the room is gated on (see
// roomStillWearsEvent): all three that the event gave the room at creation.
const ROOM = {
  name: "DesignUp decade",
  image_url: "https://cdn.example/cover.webp",
  description: EVENT_CHAT_DESCRIPTION,
};
const EVENT = { title: "DesignUp decade", cover_image_url: "https://cdn.example/cover.webp" };

test("a room in the event's own clothes still reads as the event's", () => {
  assert.equal(roomStillWearsEvent(ROOM, EVENT), true);
});

test("any personal edit takes the room out of the event's clothes", () => {
  assert.equal(roomStillWearsEvent({ ...ROOM, name: "Late night crew" }, EVENT), false);
  assert.equal(roomStillWearsEvent({ ...ROOM, image_url: "https://cdn.example/ours.webp" }, EVENT), false);
  assert.equal(roomStillWearsEvent({ ...ROOM, image_url: null }, EVENT), false);
  assert.equal(roomStillWearsEvent({ ...ROOM, description: "We talk design." }, EVENT), false);
});

test("the event's capped title still names the room it dressed", () => {
  // The room wears eventChatName(title); the offer must not read the cap as
  // an edit.
  const title = "D".repeat(200);
  assert.equal(roomStillWearsEvent({ ...ROOM, name: eventChatName(title) }, { ...EVENT, title }), true);
});

test("a coverless event and the room born without a cover match", () => {
  assert.equal(
    roomStillWearsEvent(
      { name: "Café crawl", image_url: null, description: EVENT_CHAT_DESCRIPTION },
      { title: "Café crawl", cover_image_url: null },
    ),
    true,
  );
});

test("a cleared description still counts as the event's own", () => {
  // Null means nobody wrote one — not a description of the room's own.
  assert.equal(roomStillWearsEvent({ ...ROOM, description: null }, EVENT), true);
});

// The offer also stands only while the room is still just a chat (see
// roomStillOnlyChat): the first area switched on past the chat retires it.
test("a room that is still only a chat keeps the offer standing", () => {
  assert.equal(roomStillOnlyChat(["chat"], false), true);
  assert.equal(roomStillOnlyChat([], null), true);
  assert.equal(roomStillOnlyChat(null, undefined), true);
});

test("any area past the chat retires the offer", () => {
  assert.equal(roomStillOnlyChat(["chat", "threads"], false), false);
  assert.equal(roomStillOnlyChat(["chat", "events"], false), false);
  assert.equal(roomStillOnlyChat(["chat", "resources"], false), false);
  assert.equal(roomStillOnlyChat(["chat"], true), false);
});
