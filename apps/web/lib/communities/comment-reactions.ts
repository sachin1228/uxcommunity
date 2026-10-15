import type { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";

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
 *
 * One aggregate read, not a row dump. A reaction is one row per person, and a
 * comment pill renders a count plus the caller's own highlight — never who
 * reacted — so reading the rows meant transferring a thread's popularity to
 * draw five numbers (docs/supabase-egress-audit.md §4 #7: 2,000 reactions on
 * one comment were 2,000 rows). `get_comment_reaction_summaries` answers with
 * at most one row per (comment, emoji) whatever the crowd size.
 *
 * STAGED DEPLOYS: the function is additive, so code can ship before the
 * migration. If it is not installed yet the read falls back to the per-person
 * rows and counts them here — the pre-migration behaviour, not a blank comment
 * section. A kind's table itself only exists once ITS migration is applied, and
 * the same fallback covers that: comments still render, just without reactions.
 */
export async function attachCommentReactions<T>(
  db: Db,
  rows: T[],
  userId: string,
  kind: CommentReactionKind = "threads",
): Promise<(T & { reactions: CommentReactionSummary[] })[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => String((row as { id: unknown }).id));

  const { data, error } = await callPerformanceRpc(db, "get_comment_reaction_summaries", {
    p_user_id: userId,
    p_kind: kind,
    p_comment_ids: ids,
  });

  if (!error) {
    const groups = groupCommentReactionSummaries(data ?? []);
    return rows.map((row) => ({
      ...row,
      reactions: groups.get(String((row as { id: unknown }).id)) ?? [],
    }));
  }

  if (!isSummaryRpcMissing(error)) {
    // A real failure (timeout, permissions, a bad query): comments render
    // without reactions rather than failing the whole list, as before.
    return rows.map((row) => ({ ...row, reactions: [] }));
  }

  return attachCommentReactionsByRow(db, rows, userId, kind);
}

/**
 * The pre-aggregate read, kept as the staged-deploy fallback above.
 *
 * It is the same question answered client-side: every `(user_id, emoji,
 * comment_id)` row for the page, counted here. Only reachable while
 * 20261015160000_comment_reaction_summaries has not been applied.
 */
async function attachCommentReactionsByRow<T>(
  db: Db,
  rows: T[],
  userId: string,
  kind: CommentReactionKind,
): Promise<(T & { reactions: CommentReactionSummary[] })[]> {
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

/** One row of the aggregate, as the SQL returns it. */
export interface CommentReactionGroupRow {
  comment_id: string;
  emoji: string;
  reaction_count: number;
  reacted: boolean;
}

/**
 * The aggregate's rows, folded into one emoji list per comment.
 *
 * Pure, and separate from the read so the folding is unit tested without a
 * database: the fixed emoji order is the UI's (`ALLOWED_COMMENT_REACTIONS`),
 * zero counts do not exist as pills, and an emoji the app does not offer is
 * dropped rather than rendered as an unknown chip.
 */
export function groupCommentReactionSummaries(
  rows: readonly CommentReactionGroupRow[],
): Map<string, CommentReactionSummary[]> {
  const byComment = new Map<string, Map<string, CommentReactionGroupRow>>();
  for (const row of rows) {
    let byEmoji = byComment.get(row.comment_id);
    if (!byEmoji) {
      byEmoji = new Map();
      byComment.set(row.comment_id, byEmoji);
    }
    byEmoji.set(row.emoji, row);
  }

  const summaries = new Map<string, CommentReactionSummary[]>();
  for (const [commentId, byEmoji] of byComment) {
    summaries.set(
      commentId,
      ALLOWED_COMMENT_REACTIONS.flatMap((emoji) => {
        const group = byEmoji.get(emoji);
        if (!group || group.reaction_count <= 0) return [];
        return [{ emoji, count: Number(group.reaction_count), reacted: Boolean(group.reacted) }];
      }),
    );
  }
  return summaries;
}

/**
 * Codes that mean `get_comment_reaction_summaries` is not installed yet.
 *
 * Mirror of the jobs service's `NOT_INSTALLED_CODES`: PostgREST's missing
 * function/table answers plus the raw Postgres ones a direct call can produce.
 * Anything else is a genuine failure and must not be mistaken for an
 * un-migrated database.
 */
const SUMMARY_RPC_MISSING_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01", "42501", "3F000"]);

function isSummaryRpcMissing(error: unknown): boolean {
  const code = (error as { code?: string | null } | null)?.code;
  return typeof code === "string" && SUMMARY_RPC_MISSING_CODES.has(code);
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
