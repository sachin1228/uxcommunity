import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { applyReplyAuthorIds, missingReplyAuthorIds } from "./reply-preview-authors.ts";

test("missingReplyAuthorIds lists only previews that lack an author, once each", () => {
  const messages = [
    { reply_to: { id: "a", user_id: null } },
    { reply_to: { id: "b", user_id: "user-1" } },
    { reply_to: { id: "a", user_id: "" } },
    { reply_to: { id: "c" } },
    { reply_to: null },
    {},
  ];

  assert.deepEqual(missingReplyAuthorIds(messages), ["a", "c"]);
});

test("missingReplyAuthorIds ignores previews with no anchor id", () => {
  assert.deepEqual(missingReplyAuthorIds([{ reply_to: { user_id: null } }]), []);
});

test("applyReplyAuthorIds fills only the previews that need it", () => {
  const messages = [
    { reply_to: { id: "a", user_id: null } },
    { reply_to: { id: "b", user_id: "kept" } },
    { reply_to: { id: "c", user_id: null } },
  ];
  const authors = new Map([
    ["a", "author-a"],
    ["b", "author-b"],
    ["c", "author-c"],
  ]);

  assert.equal(applyReplyAuthorIds(messages, authors), 2);
  assert.equal(messages[0].reply_to?.user_id, "author-a");
  assert.equal(messages[1].reply_to?.user_id, "kept");
  assert.equal(messages[2].reply_to?.user_id, "author-c");
});

test("applyReplyAuthorIds leaves a preview neutral when its author is unknown", () => {
  const messages = [{ reply_to: { id: "outside-page", user_id: null } }];

  assert.equal(applyReplyAuthorIds(messages, new Map()), 0);
  assert.equal(messages[0].reply_to.user_id, null);
});

test("a page resolves quoted authors from its own rows without a lookup", () => {
  // The quoted message itself is on the page (the common case): its user_id is
  // enough to colour the quote even when the RPC omitted the preview's copy.
  const messages = [
    { id: "m1", user_id: "john", reply_to: null },
    { id: "m2", user_id: "ux", reply_to: { id: "m1", user_id: null } },
  ];
  const authors = new Map(messages.map((message) => [message.id, message.user_id]));

  assert.deepEqual(missingReplyAuthorIds(messages), ["m1"]);
  assert.equal(applyReplyAuthorIds(messages, authors), 1);
  assert.equal(messages[1].reply_to?.user_id, "john");
});
