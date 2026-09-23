import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { updateCommentReactions } from "./comment-tree.ts";

const reactions = [{ emoji: "👍", count: 1, reacted: true }];

test("updateCommentReactions replaces a top-level comment's reactions", () => {
  const comments = [{ id: "a", replies: [] }, { id: "b" }];
  const next = updateCommentReactions(comments, "a", reactions);
  assert.deepEqual(next[0].reactions, reactions);
  // Untouched rows keep their identity so React can skip them.
  assert.equal(next[1], comments[1]);
});

test("updateCommentReactions reaches a nested reply", () => {
  const comments = [{ id: "a", replies: [{ id: "r1" }, { id: "r2" }] }];
  const next = updateCommentReactions(comments, "r2", reactions);
  assert.deepEqual(next[0].replies?.[1].reactions, reactions);
  assert.equal(next[0].replies?.[0], comments[0].replies[0]);
  // The parent is a new object because something below it changed.
  assert.notEqual(next[0], comments[0]);
});

test("updateCommentReactions reaches a reply in a flat list", () => {
  // The event page keeps parents and replies in one array.
  const comments = [{ id: "a" }, { id: "r1", parent_id: "a" }];
  const next = updateCommentReactions(comments, "r1", reactions);
  assert.deepEqual(next[1].reactions, reactions);
  assert.equal(next[0], comments[0]);
});

test("updateCommentReactions returns an equal list when the id is unknown", () => {
  const comments = [{ id: "a", replies: [{ id: "r1" }] }];
  const next = updateCommentReactions(comments, "nope", reactions);
  assert.deepEqual(next, comments);
  assert.equal(next[0], comments[0]);
});
