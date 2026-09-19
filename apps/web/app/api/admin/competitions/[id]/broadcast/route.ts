import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getCompetitionById, recordAudit } from "@/lib/competitions/queries";
import { sendCompetitionBroadcast, type CompetitionBroadcastKind } from "@/lib/competitions/notifications";

const KINDS: CompetitionBroadcastKind[] = ["started", "deadline_24h", "results"];

/**
 * POST /api/admin/competitions/[id]/broadcast  —  { kind }
 *
 * Lets an admin push a cycle notification on demand (e.g. results published
 * early) instead of waiting for the lazy trigger on the next page load. The
 * once-per-cycle ledger still applies: a cycle that already sent this kind
 * reports `sent: false` rather than notifying everyone twice.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  const db = createServiceClient();

  const competition = await getCompetitionById(db, id);
  if (!competition) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const kind = typeof body.kind === "string" ? (body.kind as CompetitionBroadcastKind) : "started";
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "Unknown broadcast kind." }, { status: 422 });

  const result = await sendCompetitionBroadcast(db, competition, kind);

  if (result.sent) {
    await recordAudit(db, {
      competitionId: id,
      actorId: session.userId ?? null,
      action: "broadcast_sent",
      entityType: "competition",
      entityId: id,
      metadata: { kind, recipients: result.recipients },
    });
  }

  return NextResponse.json({
    sent: result.sent,
    recipients: result.recipients,
    message: result.sent
      ? `Notified ${result.recipients} members.`
      : "This cycle already sent that notification.",
  });
}
