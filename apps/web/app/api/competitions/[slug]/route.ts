import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCompetitionDetail } from "@/lib/competitions/queries";
import { deferDueCompetitionBroadcasts } from "@/lib/competitions/notifications";
import { isCompetitionSchemaMissing } from "@/lib/competitions/setup";

/**
 * GET /api/competitions/[slug]?sort=recent|votes|featured&limit=60
 *
 * The challenge page payload: brief, rules, gallery, the viewer's own entry,
 * and — once voting has closed — the winner and stats.
 *
 * `sort=votes` is silently downgraded to chronological while voting is open
 * (see resolveEntrySort): a live leaderboard is exactly the scoreboard we do
 * not want participants playing against.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }

  const { slug } = await params;
  const db = createServiceClient();

  try {
    const payload = await loadCompetitionDetail(db, slug, session.userId!, {
      sort: request.nextUrl.searchParams.get("sort"),
      limit: Number(request.nextUrl.searchParams.get("limit")) || 60,
    });

    if (!payload) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

    deferDueCompetitionBroadcasts([payload.competition]);
    return NextResponse.json(payload);
  } catch (error) {
    if (isCompetitionSchemaMissing(error)) {
      return NextResponse.json(
        { error: "Competitions are not set up on this environment yet.", setupRequired: true },
        { status: 503 },
      );
    }
    console.error("[competitions] detail load failed", error);
    return NextResponse.json({ error: "Failed to load this competition." }, { status: 500 });
  }
}
