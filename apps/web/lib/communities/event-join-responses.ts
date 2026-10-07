import "server-only";
import type { createServiceClient } from "@/lib/supabase/service";
import { EVENT_JOIN_ANSWER_LIMITS } from "./event-join-questions";

/**
 * The database half of the join questions: recording a member's answers when
 * they join an event's group chat and reading them back for the host (see the
 * event-chat-join-questions migration for the table).
 */

type Db = ReturnType<typeof createServiceClient>;

/** One member's recorded answers — what the members tab renders per member. */
export interface EventJoinResponseRow {
  user_id: string;
  why_attend: string;
  expectations: string;
  created_at: string;
}

/** Server-side bound check mirrors the table's checks exactly. */
export function joinAnswersWithinBounds(
  answers: Record<string, unknown>,
): boolean {
  return (
    typeof answers.why_attend === "string" &&
    answers.why_attend.length >= 1 &&
    answers.why_attend.length <= EVENT_JOIN_ANSWER_LIMITS.why_attend &&
    typeof answers.expectations === "string" &&
    answers.expectations.length >= 1 &&
    answers.expectations.length <= EVENT_JOIN_ANSWER_LIMITS.expectations
  );
}

/**
 * Record (or refresh) a member's answers for an event's group chat.
 *
 * Rejoining — leave the RSVP, come back — re-asks the questions, and the
 * upsert overwrites the earlier answers so the host always reads the member's
 * current ones. A failure is logged, not thrown: the join itself must never be
 * refused over a logging problem.
 */
export async function storeEventJoinResponse(
  db: Db,
  communityId: string,
  userId: string,
  answers: {
    why_attend: string;
    expectations: string;
  },
): Promise<boolean> {
  if (!joinAnswersWithinBounds(answers)) return false;

  const { error } = await db
    .from("event_chat_join_responses")
    // Cast matches the repo-wide untyped supabase-js baseline (see next.config.js).
    .upsert(
      { community_id: communityId, user_id: userId, ...answers } as never,
      { onConflict: "community_id,user_id" },
    );
  if (error) {
    console.error("[event-join] storing join responses failed:", error);
    return false;
  }
  return true;
}

/**
 * Every member's answers for one event's group chat, keyed by user id, for the
 * host's members tab. Returns an empty map when the table does not exist yet
 * (migration pending) so the tab renders without answers instead of breaking.
 */
export async function loadEventJoinResponses(
  db: Db,
  communityId: string,
): Promise<Map<string, EventJoinResponseRow>> {
  const { data, error } = await db
    .from("event_chat_join_responses")
    .select("user_id, why_attend, expectations, created_at")
    .eq("community_id", communityId);

  const map = new Map<string, EventJoinResponseRow>();
  if (error) {
    console.error("[event-join] loading join responses failed:", error);
    return map;
  }
  for (const row of (data ?? []) as EventJoinResponseRow[]) {
    map.set(row.user_id, row);
  }
  return map;
}
