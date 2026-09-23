import type { CommentReactionSummary } from "./comment-reactions";

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
