import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getCompetitionById, recordAudit, softDeleteEntry } from "@/lib/competitions/queries";

const ACTIONS = ["feature", "unfeature", "soft_delete", "restore"] as const;
type ModerationAction = (typeof ACTIONS)[number];

/**
 * POST /api/admin/competitions/[id]/entries  —  { entryId, action, reason? }
 *
 * Moderation, not deletion. A suspicious or rule-breaking entry is soft
 * deleted: it leaves the gallery (and its votes stop counting) while the row,
 * the votes and the audit trail stay intact, so a decision can be reviewed and
 * reversed — `restore` brings it back.
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

  const entryId = typeof body.entryId === "string" ? body.entryId : "";
  const action = typeof body.action === "string" ? (body.action as ModerationAction) : ("" as ModerationAction);
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 300)
      : "Removed by an admin";

  if (!entryId) return NextResponse.json({ error: "Missing entry." }, { status: 422 });
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "Unknown action." }, { status: 422 });

  const { data: entry } = await db
    .from("competition_entries")
    .select("id, competition_id")
    .eq("id", entryId)
    .eq("competition_id", id)
    .maybeSingle();

  if (!entry) return NextResponse.json({ error: "Entry not found in this competition." }, { status: 404 });

  const actorId = session.userId ?? "";

  if (action === "soft_delete") {
    const ok = await softDeleteEntry(db, { entryId, actorId, reason });
    if (!ok) return NextResponse.json({ error: "Failed to remove the entry." }, { status: 500 });
  } else if (action === "restore") {
    const { error } = await db
      .from("competition_entries")
      .update({ soft_deleted_at: null, soft_deleted_by: null, soft_deleted_reason: null })
      .eq("id", entryId);
    if (error) return NextResponse.json({ error: "Failed to restore the entry." }, { status: 500 });
  } else {
    const { error } = await db
      .from("competition_entries")
      .update({ is_featured: action === "feature" })
      .eq("id", entryId);
    if (error) return NextResponse.json({ error: "Failed to update the entry." }, { status: 500 });
  }

  await recordAudit(db, {
    competitionId: id,
    actorId,
    action: `entry_${action}`,
    entityType: "competition_entry",
    entityId: entryId,
    metadata: { reason },
  });

  return NextResponse.json({ ok: true });
}
