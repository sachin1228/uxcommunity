import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { getCompetitionById, recordAudit } from "@/lib/competitions/queries";
import { parseCompetitionUpsertBody } from "@/lib/competitions/validation";

/** PATCH /api/admin/competitions/[id] — edit an existing cycle. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  const db = createServiceClient();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const existing = await getCompetitionById(db, id);
  if (!existing) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

  // An edit is a full replace, so a partial body is merged onto the stored row
  // before validation — the cycle timestamps in particular must stay coherent.
  const merged: Record<string, unknown> = {
    slug: existing.slug,
    week_number: existing.week_number,
    title: existing.title,
    description: existing.description,
    brief: existing.brief,
    rules: existing.rules,
    category: existing.category,
    difficulty: existing.difficulty,
    cover_image_url: existing.cover_image_url,
    start_at: existing.start_at,
    submission_deadline: existing.submission_deadline,
    voting_deadline: existing.voting_deadline,
    results_at: existing.results_at,
    archived_at: existing.archived_at,
    max_entries_per_user: existing.max_entries_per_user,
    voting_rules: existing.voting_rules,
    ...body,
  };

  const parsed = parseCompetitionUpsertBody(merged);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  const { data, error } = await db
    .from("competitions")
    .update({
      slug: parsed.value.slug,
      week_number: parsed.value.weekNumber,
      title: parsed.value.title,
      description: parsed.value.description,
      brief: parsed.value.brief,
      rules: parsed.value.rules,
      category: parsed.value.category,
      difficulty: parsed.value.difficulty,
      cover_image_url: parsed.value.coverImageUrl,
      start_at: parsed.value.startAt,
      submission_deadline: parsed.value.submissionDeadline,
      voting_deadline: parsed.value.votingDeadline,
      results_at: parsed.value.resultsAt,
      archived_at: parsed.value.archivedAt,
      max_entries_per_user: parsed.value.maxEntriesPerUser,
      voting_rules: parsed.value.votingRules,
    })
    .eq("id", id)
    .select("id, slug")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "Another competition already uses this slug." }, { status: 409 });
    }
    console.error("[admin competitions] update failed", error);
    return NextResponse.json({ error: "Failed to update the competition." }, { status: 500 });
  }

  await recordAudit(db, {
    competitionId: id,
    actorId: session.userId ?? null,
    action: "competition_updated",
    entityType: "competition",
    entityId: id,
    metadata: { fields: Object.keys(body) },
  });

  return NextResponse.json({ competition: data });
}

/** DELETE — removes a cycle and (by cascade) its entries, votes and comments. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  const db = createServiceClient();

  const existing = await getCompetitionById(db, id);
  if (!existing) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

  const { error } = await db.from("competitions").delete().eq("id", id);
  if (error) {
    console.error("[admin competitions] delete failed", error);
    return NextResponse.json({ error: "Failed to delete the competition." }, { status: 500 });
  }

  await recordAudit(db, {
    competitionId: null,
    actorId: session.userId ?? null,
    action: "competition_deleted",
    entityType: "competition",
    entityId: id,
    metadata: { slug: existing.slug, week_number: existing.week_number },
  });

  return NextResponse.json({ ok: true });
}
