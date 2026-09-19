import "server-only";

/**
 * Competition notifications, wired into the existing notifications system
 * (the `notifications` table, the bell, the realtime notifications room).
 *
 * Two kinds of message:
 *
 *   • Engagement — "someone voted for your design", "someone commented".
 *     These reuse `deferNotification` so they inherit the existing unread
 *     dedupe: several votes on one entry collapse into one row with a count
 *     instead of a new row per vote. No spam.
 *
 *   • Cycle broadcasts — "a new challenge is live", "24 hours left",
 *     "the results are in". These go to every member, so they must fire
 *     exactly once per cycle. `competition_broadcasts` is the idempotency
 *     key: the first caller that wins the insert sends, everyone else is a
 *     no-op. That makes them safe to trigger lazily from a page load, which
 *     is how a system with no cron keeps its weekly rhythm.
 */

import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { realtimeRooms, publishRealtimeBatch } from "@/lib/realtime/publish";
import { deferNotification } from "@/lib/notifications";
import type { Competition } from "./types";

type Db = ReturnType<typeof createServiceClient>;

/** How many members one broadcast page covers per insert/publish pass. */
const BROADCAST_BATCH = 400;
/** Hard ceiling so a runaway user table can never melt a request. */
const BROADCAST_MAX_RECIPIENTS = 5000;

export type CompetitionBroadcastKind = "started" | "deadline_24h" | "results";

// ---------------------------------------------------------------------------
// Engagement notifications
// ---------------------------------------------------------------------------

/** Path helpers so every notification lands on the right page. */
export function competitionHref(slug: string) {
  return `/dashboard/competitions/${slug}`;
}

export function competitionEntryHref(slug: string, entryId: string) {
  return `/dashboard/competitions/${slug}/entries/${entryId}`;
}

/**
 * "Someone voted for your design." Deferred to after the response so the vote
 * write never waits on notification delivery.
 */
export function deferCompetitionVoteNotification(input: {
  recipientId: string;
  actorId: string;
  slug: string;
  entryId: string;
  entryTitle: string;
  competitionId: string;
}) {
  if (input.recipientId === input.actorId) return;

  deferNotification({
    userId: input.recipientId,
    actorId: input.actorId,
    type: "competition_vote",
    entityType: "competition_entry",
    entityId: input.entryId,
    title: (actorName) => `${actorName} voted for your design`,
    body: input.entryTitle,
    href: competitionEntryHref(input.slug, input.entryId),
    metadata: { competition_id: input.competitionId },
  });
}

/** "Someone commented on your competition entry." */
export function deferCompetitionCommentNotification(input: {
  recipientId: string;
  actorId: string;
  slug: string;
  entryId: string;
  entryTitle: string;
  competitionId: string;
  isReply: boolean;
}) {
  if (input.recipientId === input.actorId) return;

  deferNotification({
    userId: input.recipientId,
    actorId: input.actorId,
    type: "competition_comment",
    entityType: "competition_entry",
    entityId: input.entryId,
    title: (actorName) =>
      input.isReply
        ? `${actorName} replied to a comment on your entry`
        : `${actorName} commented on your entry`,
    body: input.entryTitle,
    href: competitionEntryHref(input.slug, input.entryId),
    metadata: { competition_id: input.competitionId },
  });
}

// ---------------------------------------------------------------------------
// Cycle broadcasts
// ---------------------------------------------------------------------------

interface BroadcastCopy {
  type: "competition_started" | "competition_deadline" | "competition_results";
  title: string;
  body: string;
}

function broadcastCopy(kind: CompetitionBroadcastKind, competition: Competition): BroadcastCopy {
  switch (kind) {
    case "started":
      return {
        type: "competition_started",
        title: "🎨 A new weekly design challenge is live",
        body: `Week ${competition.week_number}: ${competition.title}`,
      };
    case "deadline_24h":
      return {
        type: "competition_deadline",
        title: "⏰ 24 hours left to submit your design",
        body: `Week ${competition.week_number}: ${competition.title}`,
      };
    case "results":
      return {
        type: "competition_results",
        title: "🏆 The results are in for this week's competition",
        body: `Week ${competition.week_number}: ${competition.title}`,
      };
  }
}

export type BroadcastResult = { sent: boolean; recipients: number };

/**
 * Sends one cycle broadcast to every active member, at most once.
 *
 * Returns `{ sent: false }` when another request already claimed the cycle —
 * the ledger insert is the lock, so concurrent page loads cannot double-send.
 */
export async function sendCompetitionBroadcast(
  db: Db,
  competition: Competition,
  kind: CompetitionBroadcastKind,
): Promise<BroadcastResult> {
  const { error: claimError } = await db
    .from("competition_broadcasts")
    .insert({ competition_id: competition.id, kind, recipient_count: 0 });

  // 23505 = unique_violation → this cycle's broadcast already went out.
  if (claimError) {
    if ((claimError as { code?: string }).code !== "23505") {
      console.error("[competitions] broadcast claim failed", claimError);
    }
    return { sent: false, recipients: 0 };
  }

  const { data: recipients, error } = await db
    .from("users")
    .select("id")
    .or("is_blocked.is.null,is_blocked.eq.false")
    .limit(BROADCAST_MAX_RECIPIENTS);

  if (error || !recipients?.length) {
    if (error) console.error("[competitions] broadcast recipients failed", error);
    return { sent: false, recipients: 0 };
  }

  const copy = broadcastCopy(kind, competition);
  const href = competitionHref(competition.slug);
  let delivered = 0;

  for (let index = 0; index < recipients.length; index += BROADCAST_BATCH) {
    const batch = recipients.slice(index, index + BROADCAST_BATCH);

    const { data: inserted, error: insertError } = await db
      .from("notifications")
      .insert(
        batch.map((recipient) => ({
          user_id: recipient.id,
          actor_id: null,
          community_id: null,
          type: copy.type,
          entity_type: "competition",
          entity_id: competition.id,
          title: copy.title,
          body: copy.body,
          href,
          metadata: { competition_id: competition.id, kind },
        })),
      )
      .select("id, user_id, type, title, body, href, read_at, created_at");

    if (insertError) {
      console.error("[competitions] broadcast insert failed", insertError);
      continue;
    }

    delivered += inserted?.length ?? 0;

    // Same shape the engagement notifications publish, so an open bell updates
    // live instead of waiting for its next refetch.
    void publishRealtimeBatch(
      (inserted ?? []).map((row) => ({
        room: realtimeRooms.notifications(String(row.user_id)),
        topic: "insert",
        data: row,
      })),
    );
  }

  await db
    .from("competition_broadcasts")
    .update({ recipient_count: delivered })
    .eq("competition_id", competition.id)
    .eq("kind", kind);

  return { sent: true, recipients: delivered };
}

/**
 * Runs the broadcast for the current cycle state, if it is due and has not
 * been sent. Called from a `after()` block on page loads: no cron, no queue,
 * and the ledger keeps it once-only.
 */
export function deferDueCompetitionBroadcasts(competitions: Competition[]): void {
  if (!competitions.length) return;

  after(async () => {
    try {
      const db = createServiceClient();
      const now = Date.now();

      for (const competition of competitions) {
        if (competition.status === "upcoming") continue;

        if (competition.status === "live") {
          await sendCompetitionBroadcast(db, competition, "started");
          const deadline = Date.parse(competition.submission_deadline);
          if (Number.isFinite(deadline) && deadline - now <= 24 * 60 * 60 * 1000) {
            await sendCompetitionBroadcast(db, competition, "deadline_24h");
          }
          continue;
        }

        if (competition.status === "results" || competition.status === "archived") {
          await sendCompetitionBroadcast(db, competition, "results");
        }
      }
    } catch (error) {
      console.error("[competitions] deferred broadcasts failed", error);
    }
  });
}
