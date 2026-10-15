/**
 * The comment-reaction aggregate, folded into pills.
 *
 * The SQL side is covered by pgTAP (supabase/tests/comment_reaction_summaries);
 * what is decided here is what the UI sees: the fixed emoji order, no zero-count
 * chips, no emoji the app does not offer, and no comment left out.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALLOWED_COMMENT_REACTIONS,
  groupCommentReactionSummaries,
  type CommentReactionGroupRow,
} from "./comment-reactions";

const COMMENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function group(overrides: Partial<CommentReactionGroupRow> = {}): CommentReactionGroupRow {
  return {
    comment_id: COMMENT,
    emoji: "👍",
    reaction_count: 1,
    reacted: false,
    ...overrides,
  };
}

test("a comment's pills come back in the UI's fixed emoji order", () => {
  const summaries = groupCommentReactionSummaries([
    group({ emoji: "👏", reaction_count: 3 }),
    group({ emoji: "👍", reaction_count: 2 }),
  ]);

  assert.deepEqual(summaries.get(COMMENT), [
    { emoji: "👍", count: 2, reacted: false },
    { emoji: "👏", count: 3, reacted: false },
  ]);
});

test("the caller's own reaction rides on the group it belongs to", () => {
  const summaries = groupCommentReactionSummaries([
    group({ emoji: "🎉", reaction_count: 9, reacted: true }),
  ]);

  assert.deepEqual(summaries.get(COMMENT), [{ emoji: "🎉", count: 9, reacted: true }]);
});

test("each comment gets its own list", () => {
  const summaries = groupCommentReactionSummaries([
    group({ comment_id: OTHER, emoji: "💡", reaction_count: 1, reacted: true }),
  ]);

  assert.equal(summaries.get(COMMENT), undefined, "an unreactioned comment has no entry at all");
  assert.deepEqual(summaries.get(OTHER), [{ emoji: "💡", count: 1, reacted: true }]);
});

test("a group of nobody is not a pill", () => {
  const summaries = groupCommentReactionSummaries([group({ reaction_count: 0 })]);

  assert.deepEqual(summaries.get(COMMENT), [], "zero counts never render a chip");
});

test("an emoji the app does not offer is dropped, not rendered as an unknown chip", () => {
  const summaries = groupCommentReactionSummaries([
    group({ emoji: "🐟", reaction_count: 4 }),
    group({ emoji: "❤️", reaction_count: 1 }),
  ]);

  assert.deepEqual(summaries.get(COMMENT), [{ emoji: "❤️", count: 1, reacted: false }]);
});

test("only the five offered emoji are ever rendered", () => {
  const rows = ALLOWED_COMMENT_REACTIONS.map((emoji, index) =>
    group({ emoji, reaction_count: index + 1, reacted: index === 0 }),
  );

  assert.deepEqual(
    groupCommentReactionSummaries(rows).get(COMMENT)?.map((reaction) => reaction.emoji),
    [...ALLOWED_COMMENT_REACTIONS],
  );
});

test("no rows at all is no summaries", () => {
  assert.equal(groupCommentReactionSummaries([]).size, 0);
});
