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
 *   • reactions — only thread comments accept the emoji reactions in
 *     `ALLOWED_COMMENT_REACTIONS`;
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
  users: { name: string; avatar_url: string | null } | null;
  replies?: CommunityComment[];
  reactions?: CommentReactionSummary[];
  image_url?: string | null;
}

/** Comments are enabled for every content kind the app can show. */
export function commentsSupported(kind: CommentKind): boolean {
  return kind === 'threads' || kind === 'resources' || kind === 'showcase' || kind === 'events';
}

/** Only thread comments can be reacted to on the web, so only they can here. */
export function commentReactionsSupported(kind: CommentKind): boolean {
  return kind === 'threads';
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
 * Toggles the viewer's emoji reaction on a thread comment and returns the
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

/** Total reactions across every emoji — the "most popular" sort key. */
export function totalCommentReactions(comment: CommunityComment): number {
  return (comment.reactions ?? []).reduce((total, reaction) => total + reaction.count, 0);
}

/** Re-export so screens can type their reaction arrays from one place. */
export type CommentReaction = Reaction;
