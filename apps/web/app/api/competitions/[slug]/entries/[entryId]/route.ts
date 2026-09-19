import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getComments,
  getCompetitionBySlug,
  getEntry,
  recordAudit,
  softDeleteEntry,
} from "@/lib/competitions/queries";
import { assertCanSubmit, assertOwnEntry, guardResponse, loadLiveEntry } from "@/lib/competitions/guards";
import { parseCompetitionEntryBody } from "@/lib/competitions/validation";

/**
 * GET /api/competitions/[slug]/entries/[entryId]
 *
 * The entry detail view: the design, its designer, and the discussion.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; entryId: string }> },
) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }

  const { slug, entryId } = await params;
  const db = createServiceClient();
  const competition = await getCompetitionBySlug(db, slug);
  if (!competition) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

  try {
    const entry = await getEntry(db, competition.id, entryId, session.userId!);
    if (!entry) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

    const comments = await getComments(db, entryId);
    return NextResponse.json({ competition, entry, comments });
  } catch (error) {
    console.error("[competitions] entry load failed", error);
    return NextResponse.json({ error: "Failed to load this entry." }, { status: 500 });
  }
}

/**
 * PATCH — edit a submission. Only the owner, and only while the cycle is live:
 * the deadline is the deadline.
 */
export async function PATCH(
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

  const blocked = guardResponse(assertCanSubmit(competition));
  if (blocked) return blocked;

  const limit = await rateLimit(`competition:entry:edit:${userId}:60s`, 12, 60);
  if (!limit.success) {
    return NextResponse.json({ error: "Too many edits. Try again shortly." }, { status: 429 });
  }

  const entry = await loadLiveEntry(db, competition.id, entryId);
  if (!entry) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  const ownership = guardResponse(assertOwnEntry(entry, userId));
  if (ownership) return ownership;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = parseCompetitionEntryBody(body, { requireDesigns: true });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  const { error } = await db
    .from("competition_entries")
    .update({
      title: parsed.value.title,
      description: parsed.value.description,
      cover_image_url: parsed.value.coverImageUrl,
      design_image_url: parsed.value.designImageUrl,
      image_urls: parsed.value.imageUrls,
      figma_url: parsed.value.figmaUrl,
      prototype_url: parsed.value.prototypeUrl,
      tools: parsed.value.tools,
      tags: parsed.value.tags,
    })
    .eq("id", entryId)
    .eq("user_id", userId);

  if (error) {
    console.error("[competitions] entry update failed", error);
    return NextResponse.json({ error: "Failed to update your entry." }, { status: 500 });
  }

  await recordAudit(db, {
    competitionId: competition.id,
    actorId: userId,
    action: "entry_edited",
    entityType: "competition_entry",
    entityId: entryId,
  });

  const updated = await getEntry(db, competition.id, entryId, userId);
  return NextResponse.json({ entry: updated });
}

/**
 * DELETE — withdraw a submission before the deadline. Soft delete, so votes and
 * history survive if the entry ever needs to be looked at again.
 */
export async function DELETE(
  _request: NextRequest,
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

  const blocked = guardResponse(assertCanSubmit(competition));
  if (blocked) return blocked;

  const entry = await loadLiveEntry(db, competition.id, entryId);
  if (!entry) return NextResponse.json({ error: "Entry not found." }, { status: 404 });

  const ownership = guardResponse(assertOwnEntry(entry, userId));
  if (ownership) return ownership;

  const deleted = await softDeleteEntry(db, {
    entryId,
    actorId: userId,
    reason: "Withdrawn by the designer before the deadline",
  });

  if (!deleted) return NextResponse.json({ error: "Failed to withdraw your entry." }, { status: 500 });

  await recordAudit(db, {
    competitionId: competition.id,
    actorId: userId,
    action: "entry_withdrawn",
    entityType: "competition_entry",
    entityId: entryId,
  });

  return NextResponse.json({ ok: true });
}
