import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's type-stripping test runner requires an explicit TS extension.
import { sortCommentTree, updateCommentReactions } from "./comment-tree.ts";

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - minutesAgo * 60_000).toISOString();

const reactions = [{ emoji: "👍", count: 1, reacted: true }];

/**
 * The shape `updateCommentReactions` walks: a comment whose replies nest the
 * same shape. Declared here so the fixtures carry the `reactions` property the
 * helper writes (and so the helper's generic infers this shape, not a
 * recursively-narrowed one).
 */
type TestComment = {
  id: string;
  parent_id?: string;
  replies?: TestComment[];
  reactions?: { emoji: string; count: number; reacted: boolean }[];
};

test("updateCommentReactions replaces a top-level comment's reactions", () => {
  const comments: TestComment[] = [{ id: "a", replies: [] }, { id: "b" }];
  const next = updateCommentReactions(comments, "a", reactions);
  assert.deepEqual(next[0].reactions, reactions);
  // Untouched rows keep their identity so React can skip them.
  assert.equal(next[1], comments[1]);
});

test("updateCommentReactions reaches a nested reply", () => {
  const comments: TestComment[] = [{ id: "a", replies: [{ id: "r1" }, { id: "r2" }] }];
  const next = updateCommentReactions(comments, "r2", reactions);
  assert.deepEqual(next[0].replies?.[1].reactions, reactions);
  assert.equal(next[0].replies?.[0], comments[0].replies![0]);
  // The parent is a new object because something below it changed.
  assert.notEqual(next[0], comments[0]);
});

test("updateCommentReactions reaches a reply in a flat list", () => {
  // The event page keeps parents and replies in one array.
  const comments: TestComment[] = [{ id: "a" }, { id: "r1", parent_id: "a" }];
  const next = updateCommentReactions(comments, "r1", reactions);
  assert.deepEqual(next[1].reactions, reactions);
  assert.equal(next[0], comments[0]);
});

test("updateCommentReactions returns an equal list when the id is unknown", () => {
  const comments: TestComment[] = [{ id: "a", replies: [{ id: "r1" }] }];
  const next = updateCommentReactions(comments, "nope", reactions);
  assert.deepEqual(next, comments);
  assert.equal(next[0], comments[0]);
});

const tree = () => [
  { id: "old", created_at: at(600), replies: undefined as { id: string; created_at: string }[] | undefined },
  { id: "new", created_at: at(1), replies: [{ id: "r-old", created_at: at(30) }, { id: "r-new", created_at: at(2) }] },
];

test("sortCommentTree orders the roots newest first", () => {
  assert.deepEqual(sortCommentTree(tree(), "newest").map((c) => c.id), ["new", "old"]);
});

test("sortCommentTree orders replies too, not just the roots", () => {
  // One root with a reply thread is the common case, and it used to look as if
  // the control did nothing at all.
  const sorted = sortCommentTree(tree(), "newest");
  assert.deepEqual(sorted[0].replies?.map((r) => r.id), ["r-new", "r-old"]);
});

test("sortCommentTree ranks popular by reactions plus replies", () => {
  const comments = [
    { id: "bare", created_at: at(1), reactions: [], replies: [] },
    { id: "answered", created_at: at(600), replies: [{ id: "r", created_at: at(599) }] },
    { id: "reacted", created_at: at(500), reactions: [{ emoji: "👍", count: 3, reacted: false }] },
  ];
  assert.deepEqual(sortCommentTree(comments, "popular").map((c) => c.id), ["reacted", "answered", "bare"]);
});

test("sortCommentTree keeps newest-first as the tie-break when nothing is engaged", () => {
  const comments = [
    { id: "old", created_at: at(600) },
    { id: "new", created_at: at(1) },
  ];
  assert.deepEqual(sortCommentTree(comments, "popular").map((c) => c.id), ["new", "old"]);
});

test("sortCommentTree keeps node identity when nothing moved", () => {
  const comments = [{ id: "a", created_at: at(2) }, { id: "b", created_at: at(30) }];
  const sorted = sortCommentTree(comments, "newest");
  assert.deepEqual(sorted.map((c) => c.id), ["a", "b"]);
  assert.equal(sorted[0], comments[0]);
});
