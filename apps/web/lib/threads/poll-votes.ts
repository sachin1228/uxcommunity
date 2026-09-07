import type { createServiceClient } from "@/lib/supabase/service";

type Database = ReturnType<typeof createServiceClient>;

/** Number of options in a thread row's poll (0 when there is no poll). */
export function pollOptionCount(row: Record<string, unknown>): number {
  const poll = row.poll;
  if (!poll || typeof poll !== "object" || Array.isArray(poll)) return 0;
  const options = (poll as { options?: unknown }).options;
  return Array.isArray(options) ? options.length : 0;
}

/**
 * Attach `poll_vote_counts` (aligned with the poll's options),
 * `poll_user_vote` (the viewer's option index, or null) and
 * `poll_undo_used` (whether the viewer has already used their one-time undo)
 * to thread rows that carry a poll. Rows without a poll are returned
 * unchanged.
 *
 * Read paths call this after their primary query so thread cards can render
 * live totals. On query failure we log and return the rows unchanged — cards
 * fall back to zeroed counts, so a vote-tally hiccup never blanks a feed.
 */
export async function attachPollVotes(
  db: Database,
  rows: Array<Record<string, unknown>>,
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  const withPoll = rows
    .map((row, index) => ({ row, index, count: pollOptionCount(row) }))
    .filter((item) => item.count > 0);

  if (!withPoll.length) return rows;

  const threadIds = [
    ...new Set(withPoll.map((item) => item.row.id).filter((id): id is string => typeof id === "string")),
  ];

  const [{ data: voteRows, error: voteError }, { data: myRows, error: myError }] = await Promise.all([
    db.from("thread_poll_votes").select("thread_id, option_index").in("thread_id", threadIds),
    db.from("thread_poll_votes").select("thread_id, option_index, undo_used").eq("user_id", userId).in("thread_id", threadIds),
  ]);

  if (voteError || myError) {
    console.error("[attachPollVotes]", voteError ?? myError);
    return rows;
  }

  const tally: Record<string, number[]> = {};
  for (const { row, count } of withPoll) {
    const id = row.id as string;
    tally[id] = Array.from({ length: count }, () => 0);
  }
  for (const vote of voteRows ?? []) {
    const counts = tally[vote.thread_id];
    if (counts && Number.isInteger(vote.option_index) && vote.option_index >= 0 && vote.option_index < counts.length) {
      counts[vote.option_index] += 1;
    }
  }

  const mine: Record<string, { optionIndex: number | null; undoUsed: boolean }> = {};
  for (const vote of myRows ?? []) {
    mine[vote.thread_id] = {
      optionIndex: Number.isInteger(vote.option_index) ? (vote.option_index as number) : null,
      undoUsed: vote.undo_used === true,
    };
  }

  return rows.map((row) => {
    const id = row.id as string;
    const mineVote = id ? mine[id] : undefined;
    return id && tally[id]
      ? {
          ...row,
          poll_vote_counts: tally[id],
          poll_user_vote: mineVote?.optionIndex ?? null,
          poll_undo_used: mineVote?.undoUsed ?? false,
        }
      : row;
  });
}
