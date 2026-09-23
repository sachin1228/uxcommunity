import type { CommentReactionSummary } from "./comment-reactions";

/** How the comment sort control orders a section. */
export type CommentSortMode = "newest" | "popular";

/** The minimum a comment needs for the sort to place it. */
export interface SortableComment {
  created_at: string;
  reactions?: CommentReactionSummary[];
  replies?: SortableComment[];
}

/**
 * Engagement of one comment: reactions plus the replies hanging off it, so a
 * comment people answered outranks a bare one even before anyone reacts.
 *
 * Reaction totals alone left "Most popular" byte-identical to "Most recent" on
 * any section where nobody had reacted yet, which reads as a broken control.
 */
function popularity(comment: { reactions?: CommentReactionSummary[]; replies?: unknown[] }): number {
  const reactions = (comment.reactions ?? []).reduce((total, reaction) => total + reaction.count, 0);
  return reactions + (comment.replies?.length ?? 0);
}

/**
 * Orders a comment tree for display. The chosen mode applies at *every* level,
 * not only to the roots: sections that hang all their comments under a single
 * root (one post with a reply thread) had nothing to reorder at the top, so the
 * control looked inert no matter what was picked.
 *
 * Nodes whose replies did not move keep their identity, so React skips them.
 */
export function sortCommentTree<T extends SortableComment>(
  comments: readonly T[],
  mode: CommentSortMode,
): T[] {
  const newestFirst = (a: SortableComment, b: SortableComment) =>
    Date.parse(b.created_at) - Date.parse(a.created_at);
  const compare = mode === "popular"
    ? (a: SortableComment, b: SortableComment) => popularity(b) - popularity(a) || newestFirst(a, b)
    : newestFirst;

  return [...comments].sort(compare).map((comment) => {
    if (!comment.replies?.length) return comment;
    const replies = sortCommentTree(comment.replies, mode) as T[];
    return replies.some((reply, index) => reply !== comment.replies![index])
      ? { ...comment, replies }
      : comment;
  });
}

/**
 * Replaces one comment's grouped reactions inside a comment list, wherever that
 * comment sits — a top-level row, a reply (nested, as threads/resources/showcase
 * keep them) or a reply in a flat list (as the event page keeps them).
 *
 * Matching by id rather than by parent makes one helper correct for both shapes,
 * so every detail page can answer the reaction POST with the same update.
 */
export function updateCommentReactions<T extends { id: string; replies?: T[] }>(
  comments: readonly T[],
  commentId: string,
  reactions: CommentReactionSummary[],
): T[] {
  return comments.map((comment) => {
    if (comment.id === commentId) return { ...comment, reactions };
    if (!comment.replies?.length) return comment;
    const replies = updateCommentReactions(comment.replies, commentId, reactions);
    // Keep the node identity when nothing below it changed.
    return replies.some((reply, index) => reply !== comment.replies![index])
      ? { ...comment, replies }
      : comment;
  });
}
