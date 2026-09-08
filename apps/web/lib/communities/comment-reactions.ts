import type { createServiceClient } from "@/lib/supabase/service";

export const ALLOWED_COMMENT_REACTIONS = ["👍", "❤️", "🎉", "💡", "👏"] as const;
export type CommentReactionEmoji = (typeof ALLOWED_COMMENT_REACTIONS)[number];
export type CommentReactionColumn = "thread_comment_id" | "resource_comment_id" | "showcase_comment_id" | "event_comment_id";

type Db = ReturnType<typeof createServiceClient>;
type Row = Record<string, unknown> & { id: string; created_at: string; parent_id?: string | null };

export function isCommentReaction(value: unknown): value is CommentReactionEmoji {
  return typeof value === "string" && ALLOWED_COMMENT_REACTIONS.includes(value as CommentReactionEmoji);
}

export async function enrichCommentReactions<T extends Row>(db: Db, rows: T[], column: CommentReactionColumn, userId: string) {
  if (!rows.length) return rows.map((row) => ({ ...row, reactions: [], reaction_count: 0 }));
  const ids = rows.map((row) => row.id);
  // The generated Supabase type is updated after the repository migration runs.
  const reactionDb = db as any;
  const { data, error } = await reactionDb
    .from("comment_reactions")
    .select(`user_id, emoji, ${column}`)
    .in(column, ids);

  // The migration is intentionally user-run. Keep comments usable before it is applied.
  if (error) return rows.map((row) => ({ ...row, reactions: [], reaction_count: 0 }));

  type ReactionRow = { user_id: string; emoji: string } & Partial<Record<CommentReactionColumn, string>>;
  const reactionRows = (data ?? []) as ReactionRow[];
  return rows.map((row) => {
    const matching = reactionRows.filter((reaction) => reaction[column] === row.id);
    const reactions = ALLOWED_COMMENT_REACTIONS.map((emoji) => ({
      emoji,
      count: matching.filter((reaction) => reaction.emoji === emoji).length,
      reacted: matching.some((reaction) => reaction.emoji === emoji && reaction.user_id === userId),
    })).filter((reaction) => reaction.count > 0);
    return { ...row, reactions, reaction_count: matching.length };
  });
}

export function nestAndSortComments<T extends Row & { replies?: T[]; reaction_count?: number }>(rows: T[], sort: "newest" | "popular") {
  const roots = rows.filter((row) => !row.parent_id).map((row) => ({ ...row, replies: [] as T[] }));
  const rootMap = new Map(roots.map((root) => [root.id, root]));
  for (const reply of rows.filter((row) => row.parent_id)) {
    rootMap.get(reply.parent_id as string)?.replies.push(reply);
  }
  for (const root of roots) root.replies.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  roots.sort((a, b) => sort === "popular"
    ? (b.reaction_count ?? 0) - (a.reaction_count ?? 0) || Date.parse(b.created_at) - Date.parse(a.created_at)
    : Date.parse(b.created_at) - Date.parse(a.created_at));
  return roots;
}

export async function toggleCommentReaction({
  db, column, commentId, userId, emoji,
}: { db: Db; column: CommentReactionColumn; commentId: string; userId: string; emoji: CommentReactionEmoji }) {
  const reactionDb = db as any;
  const { data: existing, error: lookupError } = await reactionDb
    .from("comment_reactions")
    .select("id")
    .eq(column, commentId)
    .eq("user_id", userId)
    .eq("emoji", emoji)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) {
    const { error } = await reactionDb.from("comment_reactions").delete().eq("id", existing.id).eq("user_id", userId);
    if (error) throw error;
    return false;
  }
  const { error } = await reactionDb.from("comment_reactions").insert({ [column]: commentId, user_id: userId, emoji });
  if (error) throw error;
  return true;
}
