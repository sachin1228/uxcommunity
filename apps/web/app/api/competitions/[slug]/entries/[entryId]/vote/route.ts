import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { getCompetitionBySlug, recordAudit, recordParticipant } from "@/lib/competitions/queries";
import { assertCanVote, guardResponse, loadLiveEntry } from "@/lib/competitions/guards";
import { deferCompetitionVoteNotification } from "@/lib/competitions/notifications";
import { parseVoteBody } from "@/lib/competitions/validation";

/**
 * POST /api/competitions/[slug]/entries/[entryId]/vote  —  { active: boolean }
 *
 * Votes decide community results, so this route is the authority and the
 * database is the backstop:
 *
 *   • voting must be open (deadline checked server-side, never in the client)
 *   • one vote per member per entry   → UNIQUE(competition_id, entry_id, user_id)
 *   • no voting for your own entry    → competition_votes trigger
 *   • no duplicate votes              → upsert with ignoreDuplicates
 *   • rate limited per member
 *
 * The response carries the authoritative count so the client can reconcile its
 * optimistic state instead of guessing.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; entryId: string }> },
) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const { slug, entryId } = await params;
  const userId = session.userId!;
  const db = createServiceClient();

  const competition = await getCompetitionBySlug(db, slug);
  if (!competition) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

  const blocked = guardResponse(assertCanVote(competition));
  if (blocked) return blocked;

  const limit = await rateLimit(`competition:vote:${userId}:60s`, 60, 60);
  if (!limit.success) {
    return NextResponse.json({ error: "Slow down a moment before voting again." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = parseVoteBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  const entry = await loadLiveEntry(db, competition.id, entryId);
  if (!entry) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  const selfVote = entry.user_id === userId;
  if (selfVote && !competition.voting_rules.allow_self_vote) {
    return NextResponse.json({ error: "You cannot vote for your own entry." }, { status: 403 });
  }

  if (parsed.value.active) {
    const { error } = await db.from("competition_votes").upsert(
      { competition_id: competition.id, entry_id: entryId, user_id: userId },
      { onConflict: "competition_id,entry_id,user_id", ignoreDuplicates: true },
    );

    if (error) {
      // 23514 = the trigger refused it (self vote / entry from another cycle).
      // 23505 = already voted; both are benign for a toggle that means "on".
      const code = (error as { code?: string }).code;
      if (code !== "23514" && code !== "23505") {
        console.error("[competitions] vote insert failed", error);
        return NextResponse.json({ error: "Failed to record your vote." }, { status: 500 });
      }
      if (code === "23514" && !competition.voting_rules.allow_self_vote) {
        return NextResponse.json({ error: "You cannot vote for your own entry." }, { status: 403 });
      }
    }

    await Promise.all([
      recordParticipant(db, competition.id, userId, "vote"),
      recordAudit(db, {
        competitionId: competition.id,
        actorId: userId,
        action: "vote_cast",
        entityType: "competition_entry",
        entityId: entryId,
      }),
    ]);

    deferCompetitionVoteNotification({
      recipientId: entry.user_id,
      actorId: userId,
      slug: competition.slug,
      entryId,
      entryTitle: entry.title,
      competitionId: competition.id,
    });
  } else {
    if (!competition.voting_rules.allow_vote_removal) {
      return NextResponse.json({ error: "Votes cannot be withdrawn in this challenge." }, { status: 403 });
    }

    const { error } = await db
      .from("competition_votes")
      .delete()
      .eq("competition_id", competition.id)
      .eq("entry_id", entryId)
      .eq("user_id", userId);

    if (error) {
      console.error("[competitions] vote delete failed", error);
      return NextResponse.json({ error: "Failed to remove your vote." }, { status: 500 });
    }

    await recordAudit(db, {
      competitionId: competition.id,
      actorId: userId,
      action: "vote_withdrawn",
      entityType: "competition_entry",
      entityId: entryId,
    });
  }

  const { count } = await db
    .from("competition_votes")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", entryId);

  return NextResponse.json({ active: parsed.value.active, count: count ?? 0 });
}
