import assert from "node:assert/strict";
import { test } from "node:test";
import { filterConversations } from "./search";
import type { DmConversationSummary } from "./types";

function conversation(id: string, name: string): DmConversationSummary {
  return {
    id,
    peer: { id: `peer-${id}`, name, avatar_url: null },
    last_message: null,
    unread_count: 0,
    my_last_read_at: null,
    last_message_at: null,
  };
}

const LIST = [
  conversation("c1", "ux community"),
  conversation("c2", "john doe"),
  conversation("c3", "amy jackson"),
];

test("an empty query returns the list unchanged, by reference", () => {
  assert.equal(filterConversations(LIST, ""), LIST);
  assert.equal(filterConversations(LIST, "   "), LIST);
});

test("matches a peer name as a case-insensitive substring", () => {
  assert.deepEqual(filterConversations(LIST, "JOHN").map((c) => c.id), ["c2"]);
  assert.deepEqual(filterConversations(LIST, "jack").map((c) => c.id), ["c3"]);
});

test("matches a whole name and a single letter", () => {
  assert.deepEqual(filterConversations(LIST, "john doe").map((c) => c.id), ["c2"]);
  assert.deepEqual(filterConversations(LIST, "a").map((c) => c.id), ["c3"]);
});

test("trims the query before matching", () => {
  assert.deepEqual(filterConversations(LIST, "  amy  ").map((c) => c.id), ["c3"]);
});

test("keeps the order the rows arrived in", () => {
  // Every name here contains "n", so the survivors keep their input order
  // rather than being re-sorted.
  assert.deepEqual(
    filterConversations([...LIST].reverse(), "n").map((c) => c.id),
    ["c3", "c2", "c1"],
  );
});

test("no match yields an empty list", () => {
  assert.deepEqual(filterConversations(LIST, "zzz"), []);
});

test("does not match on the message preview (names only)", () => {
  const withMessage: DmConversationSummary = {
    ...conversation("c4", "amy jackson"),
    last_message: {
      id: "m1",
      content: "hello from the other side",
      image_url: null,
      created_at: "2026-10-12T12:00:00.000Z",
      user_id: "peer-c4",
      deleted_at: null,
      edited_at: null,
    },
  };
  assert.deepEqual(filterConversations([withMessage], "other side"), []);
});
