/**
 * Comments on community content — a React Native port of the web
 * `components/communities/CommentSection.tsx` data layer.
 *
 * The web app shares one comment component across threads, showcase posts,
 * resources and events, but each content type has its own table and route
 * segment. The shapes differ in three ways the client has to absorb:
 *
 *   • nested vs. flat — threads/resources/showcase nest replies under their
 *     parent, events return a flat list that the client nests itself;
 *   • reactions — every kind now stores them, each in its own table;
 *   • limits — showcase caps a comment at 1000 characters, everything else at
 *     5000 (events allow an optional image instead of text).
 *
 * Endpoints: /api/communities/:id/{kind}/:targetId/comments[/:commentId]
 */

import { apiFetch } from './api';
import type { Reaction } from './chat';

/** URL segment for the comments API — matches the web `CommentKind`. */
export type CommentKind = 'threads' | 'resources' | 'showcase' | 'events';

/** Same fixed set the web app allows, in the same order. */
export const ALLOWED_COMMENT_REACTIONS = ['👍', '❤️', '🎉', '💡', '👏'] as const;
export type CommentReactionEmoji = (typeof ALLOWED_COMMENT_REACTIONS)[number];

/** One emoji's aggregate on a comment: total count + whether the viewer reacted. */
export interface CommentReactionSummary {
  emoji: string;
  count: number;
  reacted: boolean;
}

export interface CommunityComment {
  id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  /** `designation` is the author's experience level ("Senior designer"), the
   *  label the members list shows; null when the profile has none. */
  users: { name: string; avatar_url: string | null; designation?: string | null } | null;
  replies?: CommunityComment[];
  reactions?: CommentReactionSummary[];
  image_url?: string | null;
}

/** Comments are enabled for every content kind the app can show. */
export function commentsSupported(kind: CommentKind): boolean {
  return kind === 'threads' || kind === 'resources' || kind === 'showcase' || kind === 'events';
}

/**
 * Every kind stores comment reactions in its own table (see the
 * `*_comment_reactions` migrations), so the emoji picker is available on all
 * four surfaces — matching the web app.
 */
export function commentReactionsSupported(kind: CommentKind): boolean {
  return kind === 'threads' || kind === 'resources' || kind === 'showcase' || kind === 'events';
}

/** Max body length per content type, matching each POST route's validation. */
export const COMMENT_MAX_LENGTH: Record<CommentKind, number> = {
  threads: 5000,
  resources: 5000,
  showcase: 1000,
  events: 2000,
};

function commentsPath(communityId: string, kind: CommentKind, targetId: string): string {
  return `/api/communities/${communityId}/${kind}/${targetId}/comments`;
}

/**
 * Nests a flat comment list when the API did not (events) and guarantees every
 * top-level comment has a `replies` array, so the renderer can treat all kinds
 * the same way.
 */
export function nestComments(rows: CommunityComment[]): CommunityComment[] {
  const top: CommunityComment[] = rows
    .filter((comment) => !comment.parent_id)
    .map((comment) => ({ ...comment, replies: [...(comment.replies ?? [])] }));

  for (const reply of rows.filter((comment) => comment.parent_id)) {
    const parent = top.find((comment) => comment.id === reply.parent_id);
    if (parent) parent.replies!.push(reply);
  }
  return top;
}

export async function getComments(
  communityId: string,
  kind: CommentKind,
  targetId: string,
): Promise<CommunityComment[]> {
  const { data } = await apiFetch<{ comments?: CommunityComment[] }>(
    commentsPath(communityId, kind, targetId),
  );
  return nestComments(data.comments ?? []);
}

export async function postComment(
  communityId: string,
  kind: CommentKind,
  targetId: string,
  payload: { body: string; parent_id?: string | null },
): Promise<CommunityComment> {
  const { data } = await apiFetch<{ comment: CommunityComment }>(
    commentsPath(communityId, kind, targetId),
    {
      method: 'POST',
      body: {
        body: payload.body,
        ...(payload.parent_id ? { parent_id: payload.parent_id } : {}),
      },
    },
  );
  return { ...data.comment, replies: data.comment.replies ?? [], reactions: data.comment.reactions ?? [] };
}

export async function deleteComment(
  communityId: string,
  kind: CommentKind,
  targetId: string,
  commentId: string,
): Promise<void> {
  await apiFetch(`${commentsPath(communityId, kind, targetId)}/${commentId}`, { method: 'DELETE' });
}

/**
 * Toggles the viewer's emoji reaction on a comment and returns the
 * authoritative grouped state for that comment.
 */
export async function toggleCommentReaction(
  communityId: string,
  kind: CommentKind,
  targetId: string,
  commentId: string,
  emoji: CommentReactionEmoji,
): Promise<CommentReactionSummary[]> {
  const { data } = await apiFetch<{ reactions?: CommentReactionSummary[] }>(
    `${commentsPath(communityId, kind, targetId)}/${commentId}/reactions`,
    { method: 'POST', body: { emoji } },
  );
  return data.reactions ?? [];
}

/** Optimistic flip of one emoji on a comment, mirroring the web behaviour. */
export function projectCommentReaction(
  reactions: CommentReactionSummary[],
  emoji: string,
): CommentReactionSummary[] {
  const mine = reactions.find((reaction) => reaction.emoji === emoji);
  if (!mine) return [...reactions, { emoji, count: 1, reacted: true }];
  return reactions
    .map((reaction) =>
      reaction.emoji === emoji
        ? { ...reaction, count: Math.max(0, reaction.count - 1), reacted: false }
        : reaction,
    )
    .filter((reaction) => reaction.count > 0);
}

/** Total reactions across every emoji — half the "most popular" sort key. */
export function totalCommentReactions(comment: CommunityComment): number {
  return (comment.reactions ?? []).reduce((total, reaction) => total + reaction.count, 0);
}

/** How the sort control orders a section. */
export type CommentSortOrder = 'newest' | 'popular';

/**
 * Engagement of one comment: reactions plus the replies hanging off it, so a
 * comment people answered outranks a bare one even before anyone reacts.
 * Reaction totals alone left "Most popular" identical to "Most recent" on any
 * section where nobody had reacted yet.
 */
function commentEngagement(comment: CommunityComment): number {
  return totalCommentReactions(comment) + (comment.replies?.length ?? 0);
}

/**
 * Orders a comment tree for display. The chosen order applies at *every* level,
 * not only to the roots: a post whose comments all hang under a single root has
 * nothing to reorder at the top, so the control used to look inert.
 */
export function sortComments(
  comments: CommunityComment[],
  order: CommentSortOrder,
): CommunityComment[] {
  const newestFirst = (a: CommunityComment, b: CommunityComment) =>
    Date.parse(b.created_at) - Date.parse(a.created_at);
  const compare =
    order === 'popular'
      ? (a: CommunityComment, b: CommunityComment) =>
          commentEngagement(b) - commentEngagement(a) || newestFirst(a, b)
      : newestFirst;

  return [...comments]
    .sort(compare)
    .map((comment) =>
      comment.replies?.length
        ? { ...comment, replies: sortComments(comment.replies, order) }
        : comment,
    );
}

/** Re-export so screens can type their reaction arrays from one place. */
export type CommentReaction = Reaction;
