import type { createServiceClient } from "@/lib/supabase/service";

/**
 * Emoji reactions on community comments. Writes go through the authenticated
 * Next.js API routes; RLS keeps direct client access read-only.
 */

/** Every comment section that carries reactions, keyed like the API routes. */
export type CommentReactionKind = "threads" | "resources" | "showcase" | "events";

/**
 * One table per comment table, so each reaction keeps a real foreign key (see
 * `20260923120000_comment_reactions_all_kinds.sql`). Threads shipped first with
 * its own table; the others mirror it.
 */
const REACTION_TABLES: Record<CommentReactionKind, string> = {
  threads: "thread_comment_reactions",
  resources: "resource_comment_reactions",
  showcase: "showcase_comment_reactions",
  events: "event_comment_reactions",
};

export const ALLOWED_COMMENT_REACTIONS = ["👍", "❤️", "🎉", "💡", "👏"] as const;
export type CommentReactionEmoji = (typeof ALLOWED_COMMENT_REACTIONS)[number];

/** One emoji's aggregate on a comment: total count + whether the viewer reacted. */
export interface CommentReactionSummary {
  emoji: string;
  count: number;
  reacted: boolean;
}

type Db = ReturnType<typeof createServiceClient>;

export function isCommentReaction(value: unknown): value is CommentReactionEmoji {
  return typeof value === "string" && (ALLOWED_COMMENT_REACTIONS as readonly string[]).includes(value);
}

/**
 * Groups all reactions for the given comment rows by emoji, in the fixed
 * ALLOWED_COMMENT_REACTIONS order. Rows without reactions get an empty list.
 * A kind's table only exists once its migration is applied — on lookup failure
 * comments still render, just without reactions.
 */
export async function attachCommentReactions<T>(
  db: Db,
  rows: T[],
  userId: string,
  kind: CommentReactionKind = "threads",
): Promise<(T & { reactions: CommentReactionSummary[] })[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => String((row as { id: unknown }).id));
  // Generated Supabase types are updated after the repository migration runs.
  const reactionDb = db as any;
  const { data, error } = await reactionDb
    .from(REACTION_TABLES[kind])
    .select("user_id, emoji, comment_id")
    .in("comment_id", ids);

  if (error) return rows.map((row) => ({ ...row, reactions: [] }));

  const reactionRows = (data ?? []) as Array<{ user_id: string; emoji: string; comment_id: string | null }>;
  return rows.map((row) => {
    const matching = reactionRows.filter((reaction) => reaction.comment_id === String((row as { id: unknown }).id));
    const reactions = ALLOWED_COMMENT_REACTIONS.map((emoji) => ({
      emoji,
      count: matching.filter((reaction) => reaction.emoji === emoji).length,
      reacted: matching.some((reaction) => reaction.emoji === emoji && reaction.user_id === userId),
    })).filter((reaction) => reaction.count > 0);
    return { ...row, reactions };
  });
}

/** Adds or removes the user's reaction for one emoji. Returns the new state. */
export async function toggleCommentReaction({
  db,
  commentId,
  userId,
  emoji,
  kind = "threads",
}: {
  db: Db;
  commentId: string;
  userId: string;
  emoji: CommentReactionEmoji;
  kind?: CommentReactionKind;
}): Promise<boolean> {
  const table = REACTION_TABLES[kind];
  const reactionDb = db as any;
  const { data: existing, error: lookupError } = await reactionDb
    .from(table)
    .select("id")
    .eq("comment_id", commentId)
    .eq("user_id", userId)
    .eq("emoji", emoji)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    const { error } = await reactionDb
      .from(table)
      .delete()
      .eq("id", existing.id)
      .eq("user_id", userId);
    if (error) throw error;
    return false;
  }

  const { error } = await reactionDb
    .from(table)
    .insert({ comment_id: commentId, user_id: userId, emoji });
  if (error) throw error;
  return true;
}
