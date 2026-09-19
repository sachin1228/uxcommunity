import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCompetitionHome } from "@/lib/competitions/queries";
import { deferDueCompetitionBroadcasts } from "@/lib/competitions/notifications";
import { isCompetitionSchemaMissing } from "@/lib/competitions/setup";

/**
 * GET /api/competitions
 *
 * Everything the landing page renders: the current cycle with its stats and a
 * preview of the gallery, the winner when the current cycle is in results, the
 * next cycle, and the recent archive.
 *
 * Reading is also what nudges the weekly notifications: a cycle's start /
 * deadline / results broadcast is claimed here (once, via the
 * competition_broadcasts ledger) so the product keeps its rhythm without a
 * cron job.
 */
export async function GET() {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }

  const db = createServiceClient();

  try {
    const payload = await loadCompetitionHome(db, session.userId!);

    deferDueCompetitionBroadcasts(
      [payload.current, payload.upcoming].filter(
        (competition): competition is NonNullable<typeof competition> => Boolean(competition),
      ),
    );

    return NextResponse.json(payload);
  } catch (error) {
    if (isCompetitionSchemaMissing(error)) {
      return NextResponse.json(
        { error: "Competitions are not set up on this environment yet.", setupRequired: true },
        { status: 503 },
      );
    }
    console.error("[competitions] home load failed", error);
    return NextResponse.json({ error: "Failed to load competitions." }, { status: 500 });
  }
}
